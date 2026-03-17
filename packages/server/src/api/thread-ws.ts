import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Effect, Stream } from "effect";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderEventEnvelope } from "../providers/events.js";
import prisma from "../db/prisma.js";
import { consumeWsTicket } from "../auth/ws-tickets.js";
import { ptyManager } from "../terminal/pty-manager.js";
import { randomUUID } from "node:crypto";

interface ThreadConnection {
  ws: WebSocket;
  threadId: string;
  userId: string;
}

interface ProjectConnection {
  ws: WebSocket;
  projectId: string;
  userId: string;
}

// Project-level connections for thread.status fan-out
const projectConnections = new Map<string, Set<ProjectConnection>>();
// Cache: threadId → projectId (populated from DB on first lookup, bounded to prevent leaks)
const THREAD_PROJECT_CACHE_MAX = 10_000;
const threadToProject = new Map<string, string>();

async function resolveProjectId(threadId: string): Promise<string | null> {
  const cached = threadToProject.get(threadId);
  if (cached) return cached;
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    select: { projectId: true },
  });
  if (thread?.projectId) {
    // Evict oldest entries if cache is full
    if (threadToProject.size >= THREAD_PROJECT_CACHE_MAX) {
      const firstKey = threadToProject.keys().next().value;
      if (firstKey) threadToProject.delete(firstKey);
    }
    threadToProject.set(threadId, thread.projectId);
    return thread.projectId;
  }
  return null;
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

    console.log(`[thread-ws] Client connected: thread=${threadId} user=${authedUserId}`);

    const conn: ThreadConnection = { ws, threadId, userId: authedUserId };
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

    // Keep-alive: ping every 25s to prevent proxy/LB timeouts
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 25_000);

    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        // Handle client-side pings (for proxies that don't forward WS pings)
        if (message.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }
        console.log(`[thread-ws] Command: ${message.type} thread=${threadId}`);
        await handleCommand(message, threadId, authedUserId!, providerService, ws, connections);
      } catch (err: any) {
        console.error(`[thread-ws] Command error thread=${threadId}:`, err.message ?? err);
        ws.send(
          JSON.stringify({
            type: "thread.error",
            error: err.message ?? "Invalid command",
          })
        );
      }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      console.log(`[thread-ws] Client disconnected: thread=${threadId}`);
      connections.get(threadId)?.delete(conn);
      if (connections.get(threadId)?.size === 0) {
        connections.delete(threadId);
      }
    });
  });
}

async function resolveUserCredentials(userId: string) {
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "github" },
  });

  return {
    apiKey: settings?.anthropicApiKey ?? undefined,
    useSubscription: settings?.claudeSubscription ?? false,
    githubToken: account?.accessToken ?? undefined,
  };
}

async function handleCommand(
  message: any,
  threadId: string,
  userId: string,
  providerService: ProviderService,
  ws: WebSocket,
  connections: Map<string, Set<ThreadConnection>>
): Promise<void> {
  const tid = ThreadId(threadId);

  switch (message.type) {
    case "thread.sendTurn": {
      // Ensure session is active (auto-restart if lost)
      const creds = await resolveUserCredentials(userId);
      await Effect.runPromise(
        providerService.ensureSession(tid, creds)
      );

      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: tid,
          text: message.text,
          model: message.model,
          effort: message.effort,
          attachments: message.attachments,
        })
      );
      console.log(`[thread-ws] Turn started: thread=${threadId} turn=${result.turnId}`);
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

    case "thread.rewindFiles": {
      // Rewind file changes to a specific checkpoint
      // Uses the SDK's rewindFiles() function if available
      try {
        const sdk = await import("@anthropic-ai/claude-agent-sdk");
        const rewindFiles = (sdk as any).rewindFiles;
        if (rewindFiles && message.checkpointId) {
          await rewindFiles(message.checkpointId);
          ws.send(JSON.stringify({
            type: "thread.rewindComplete",
            checkpointId: message.checkpointId,
          }));
        } else {
          ws.send(JSON.stringify({
            type: "thread.error",
            error: "rewindFiles not available or missing checkpointId",
          }));
        }
      } catch (err: any) {
        ws.send(JSON.stringify({
          type: "thread.error",
          error: `Rewind failed: ${err.message}`,
        }));
      }
      break;
    }

    case "thread.forkSession": {
      // Fork the session — next sendTurn will use forkSession: true
      const creds = await resolveUserCredentials(userId);
      await Effect.runPromise(
        providerService.ensureSession(tid, creds)
      );

      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: tid,
          text: message.text ?? "Continue from this point.",
          model: message.model,
          effort: message.effort,
          forkSession: true,
        })
      );
      ws.send(JSON.stringify({ type: "thread.turn.started", turnId: result.turnId }));
      break;
    }

    case "thread.terminal.start": {
      // Check if this thread already has a PTY session
      let session = ptyManager.getForThread(threadId);
      if (session) {
        ws.send(JSON.stringify({
          type: "thread.terminal.started",
          sessionId: session.id,
        }));
        // Send a newline to trigger a fresh prompt for the reconnecting client
        ptyManager.write(session.id, "\n");
        return;
      }

      // Look up thread to determine workspace path
      const termThread = await prisma.thread.findUnique({ where: { id: threadId } });
      const cwd = termThread?.workspacePath ?? process.env.HOME ?? "/";
      const sessionId = `pty-${randomUUID()}`;

      session = ptyManager.start({
        sessionId,
        threadId,
        cols: message.cols ?? 120,
        rows: message.rows ?? 30,
        cwd,
      });

      // Wire PTY output to all WebSocket clients for this thread
      session.emitter.on("data", (data: string) => {
        const conns = connections.get(threadId);
        if (!conns) return;
        const payload = JSON.stringify({
          type: "thread.terminal.output",
          sessionId,
          data,
        });
        for (const c of conns) {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(payload);
          }
        }
      });

      session.emitter.on("exit", ({ exitCode }: { exitCode: number }) => {
        const conns = connections.get(threadId);
        if (!conns) return;
        const payload = JSON.stringify({
          type: "thread.terminal.exited",
          sessionId,
          exitCode,
        });
        for (const c of conns) {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(payload);
          }
        }
      });

      ws.send(JSON.stringify({
        type: "thread.terminal.started",
        sessionId,
      }));
      console.log(`[thread-ws] PTY started: thread=${threadId} session=${sessionId}`);
      break;
    }

    case "thread.terminal.input": {
      if (!message.data) break;
      ptyManager.write(message.sessionId, message.data);
      break;
    }

    case "thread.terminal.resize": {
      if (message.cols && message.rows) {
        ptyManager.resize(message.sessionId, message.cols, message.rows);
      }
      break;
    }

    case "thread.terminal.stop": {
      const killed = ptyManager.kill(message.sessionId);
      ws.send(JSON.stringify({
        type: "thread.terminal.exited",
        sessionId: message.sessionId,
        exitCode: killed ? 0 : -1,
      }));
      break;
    }

    case "thread.continueSession": {
      const creds = await resolveUserCredentials(userId);
      await Effect.runPromise(
        providerService.ensureSession(tid, creds)
      );
      ws.send(JSON.stringify({
        type: "thread.session.status",
        threadId,
        status: "active",
      }));
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
      const isThreadStatus = envelope.type === "thread.status";

      // thread.status events are transient — do NOT persist or send to thread-level clients
      if (!isThreadStatus) {
        // Fan out to thread-level WebSocket clients (before persistence)
        const threadConns = connections.get(envelope.threadId as string);
        if (threadConns && threadConns.size > 0) {
          const { raw, ...slimEnvelope } = envelope as ProviderEventEnvelope & { raw?: unknown };
          try {
            const payload = JSON.stringify({
              type: "thread.event",
              event: slimEnvelope,
            });

            for (const conn of threadConns) {
              if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(payload);
              }
            }
          } catch (err) {
            console.error("[thread-ws] Failed to serialize event:", envelope.type, err);
          }
        }

        // Persist event to database (non-fatal)
        yield* providerService.persistEvent(envelope).pipe(
          Effect.catchAll((err) =>
            Effect.sync(() => {
              console.error("[thread-ws] Failed to persist event:", envelope.type, err);
            })
          )
        );
      }

      // Forward thread.status events to project-level connections
      if (isThreadStatus) {
        yield* Effect.promise(async () => {
          const pid = await resolveProjectId(envelope.threadId as string);
          if (!pid) return;
          const projConns = projectConnections.get(pid);
          if (!projConns || projConns.size === 0) return;

          try {
            const payload = JSON.stringify({
              type: "thread.status",
              threadId: envelope.threadId,
              ...envelope.payload,
            });
            for (const conn of projConns) {
              if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(payload);
              }
            }
          } catch (err) {
            console.error("[thread-ws] Failed to fan out thread.status:", err);
          }
        });
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

export function setupProjectEventsWebSocket(
  server: HttpServer,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/ws\/projects\/([^/]+)\/events$/);
    if (match) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, match[1]);
      });
    }
  });

  wss.on("connection", async (ws: WebSocket, req: any, projectId: string) => {
    // Authenticate via ticket or session cookie (same pattern as thread WS)
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    let authedUserId: string | null = null;

    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      authedUserId = consumeWsTicket(ticket);
    }

    if (!authedUserId) {
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c: string) => {
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

    // Verify project exists and belongs to user
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, name: true },
    });
    if (!project || (project.userId && project.userId !== authedUserId)) {
      ws.close(4003, "Not authorized");
      return;
    }

    console.log(`[project-ws] Client connected: project=${projectId} user=${authedUserId}`);

    const conn: ProjectConnection = { ws, projectId, userId: authedUserId };
    if (!projectConnections.has(projectId)) {
      projectConnections.set(projectId, new Set());
    }
    projectConnections.get(projectId)!.add(conn);

    // Send initial state: find threads with unresolved ask_user requests
    // Uses batched queries instead of per-thread lookups to avoid N+1
    try {
      const threads = await prisma.thread.findMany({
        where: { projectId, archivedAt: null },
        select: { id: true, title: true },
      });
      const threadIds = threads.map((t) => t.id);
      if (threadIds.length > 0) {
        // Batch: get the most recent ask_user event per thread
        const askEvents = await prisma.threadEvent.findMany({
          where: { threadId: { in: threadIds }, type: "ask_user" },
          orderBy: { createdAt: "desc" },
          distinct: ["threadId"],
        });
        if (askEvents.length > 0) {
          // Batch: get all request.resolved events for these threads and filter in JS
          const requestIds = new Set(
            askEvents.map((e) => (e.payload as any)?.requestId).filter(Boolean)
          );
          const resolvedEvents = await prisma.threadEvent.findMany({
            where: {
              threadId: { in: threadIds },
              type: "request.resolved",
            },
            select: { payload: true },
          });
          const resolvedRequestIds = new Set(
            resolvedEvents
              .map((e) => (e.payload as any)?.requestId)
              .filter((id: string) => id && requestIds.has(id))
          );

          const titleMap = new Map(threads.map((t) => [t.id, t.title]));
          for (const ask of askEvents) {
            const p = ask.payload as any;
            if (p?.requestId && !resolvedRequestIds.has(p.requestId)) {
              ws.send(JSON.stringify({
                type: "thread.status",
                threadId: ask.threadId,
                status: "needs_input",
                requestId: p.requestId,
                question: p?.question ?? "Agent needs input",
                options: p?.options ?? [],
                threadName: titleMap.get(ask.threadId) ?? undefined,
              }));
            }
          }
        }
      }
    } catch (err) {
      console.error("[project-ws] Failed to send initial state:", err);
    }

    // Keep-alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 25_000);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {}
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      console.log(`[project-ws] Client disconnected: project=${projectId}`);
      projectConnections.get(projectId)?.delete(conn);
      if (projectConnections.get(projectId)?.size === 0) {
        projectConnections.delete(projectId);
      }
    });
  });
}
