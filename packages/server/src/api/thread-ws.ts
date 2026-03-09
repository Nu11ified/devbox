import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Effect, Stream } from "effect";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderEventEnvelope } from "../providers/events.js";
import prisma from "../db/prisma.js";
import { consumeWsTicket } from "../auth/ws-tickets.js";

interface ThreadConnection {
  ws: WebSocket;
  threadId: string;
}

export function setupThreadWebSocket(
  server: HttpServer,
  providerService: ProviderService
): void {
  const wss = new WebSocketServer({ noServer: true });
  const connections = new Map<string, Set<ThreadConnection>>();

  // Handle upgrade requests for /ws/threads path
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    if (url.pathname === "/ws/threads") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    }
    // Don't handle other paths — let existing WS handler deal with them
  });

  // Start event stream consumer
  startEventFanOut(providerService, connections);

  wss.on("connection", async (ws: WebSocket, req: InstanceType<typeof import("http").IncomingMessage>) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const threadId = url.searchParams.get("threadId");

    if (!threadId) {
      ws.close(4000, "threadId query parameter required");
      return;
    }

    // Validate UUID format before querying (e.g. "new" is not a valid thread ID)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(threadId)) {
      ws.close(4000, "Invalid threadId format");
      return;
    }

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread) {
      ws.close(4004, "Thread not found");
      return;
    }

    // Authenticate via ticket (cross-origin) or session cookie (same-origin)
    let authedUserId: string | null = null;

    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      authedUserId = consumeWsTicket(ticket);
    }

    if (!authedUserId) {
      // Fall back to session cookie
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c) => {
          const [key, ...rest] = c.trim().split("=");
          return [key, rest.join("=")];
        })
      );
      const sessionToken = cookies["better-auth.session_token"] ?? cookies["__Secure-better-auth.session_token"];

      if (sessionToken) {
        const session = await prisma.session.findUnique({
          where: { token: sessionToken },
          include: { user: true },
        });
        if (session && session.expiresAt >= new Date()) {
          authedUserId = session.user.id;
        }
      }
    }

    if (!authedUserId) {
      ws.close(4001, "Authentication required");
      return;
    }

    // Verify ownership
    if (thread.userId && thread.userId !== authedUserId) {
      ws.close(4003, "Not authorized");
      return;
    }

    const conn: ThreadConnection = { ws, threadId };
    if (!connections.has(threadId)) {
      connections.set(threadId, new Set());
    }
    connections.get(threadId)!.add(conn);

    // Send current status
    ws.send(
      JSON.stringify({
        type: "thread.session.status",
        threadId,
        status: thread.status,
        provider: thread.provider,
        model: thread.model,
      })
    );

    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        await handleCommand(message, threadId, providerService, ws);
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "thread.error",
            error: err.message ?? "Invalid command",
          })
        );
      }
    });

    ws.on("close", () => {
      connections.get(threadId)?.delete(conn);
      if (connections.get(threadId)?.size === 0) {
        connections.delete(threadId);
      }
    });
  });
}

async function handleCommand(
  message: any,
  threadId: string,
  providerService: ProviderService,
  ws: WebSocket
): Promise<void> {
  const tid = ThreadId(threadId);

  switch (message.type) {
    case "thread.sendTurn": {
      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: tid,
          text: message.text,
          model: message.model,
          attachments: message.attachments,
        })
      );
      ws.send(JSON.stringify({ type: "thread.turn.started", turnId: result.turnId }));
      break;
    }

    case "thread.interrupt": {
      await Effect.runPromise(providerService.interruptTurn(tid));
      ws.send(JSON.stringify({ type: "thread.turn.interrupted", threadId }));
      break;
    }

    case "thread.approval": {
      await Effect.runPromise(
        providerService.respondToRequest(tid, message.requestId, {
          type: message.decision,
          reason: message.reason,
        })
      );
      break;
    }

    case "thread.stop": {
      await Effect.runPromise(providerService.stopThread(tid));
      ws.send(
        JSON.stringify({
          type: "thread.session.status",
          threadId,
          status: "idle",
        })
      );
      break;
    }

    default:
      ws.send(
        JSON.stringify({
          type: "thread.error",
          error: `Unknown command: ${message.type}`,
        })
      );
  }
}

function startEventFanOut(
  providerService: ProviderService,
  connections: Map<string, Set<ThreadConnection>>
): void {
  const stream = providerService.mergedEventStream();

  const program = Stream.runForEach(stream, (envelope: ProviderEventEnvelope) =>
    Effect.gen(function* () {
      // Persist event to database
      yield* providerService.persistEvent(envelope);

      // Fan out to WebSocket clients
      const threadConns = connections.get(envelope.threadId as string);
      if (!threadConns) return;

      const payload = JSON.stringify({
        type: "thread.event",
        event: envelope,
      });

      for (const conn of threadConns) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(payload);
        }
      }
    })
  );

  Effect.runFork(
    program.pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error("[thread-ws] Event fan-out stream error:", error);
        })
      )
    )
  );
}
