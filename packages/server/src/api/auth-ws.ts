import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { CredentialStore } from "../auth/credential-store.js";
import type { AuthContainerService } from "../auth/auth-container.js";
import { consumeWsTicket } from "../auth/ws-tickets.js";

const VALID_PROVIDERS = new Set(["claude", "codex"]);

export function setupAuthWebSocket(
  credentialStore: CredentialStore,
  authContainerService: AuthContainerService,
) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage, userId: string, provider: string) => {
    let cleanup: (() => Promise<void>) | null = null;

    try {
      const result = authContainerService.spawnAuthProcess(userId, provider);
      cleanup = result.cleanup;
      const child = result.process;

      ws.send(JSON.stringify({ type: "auth.ready" }));

      // stdout → WebSocket
      child.stdout?.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: chunk.toString() }));
        }
      });

      // stderr → WebSocket
      child.stderr?.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: chunk.toString() }));
        }
      });

      // Process exit
      child.on("exit", (code) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: `\r\nProcess exited with code ${code}\r\n` }));
        }
      });

      // WebSocket → stdin
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "data" && msg.data) {
            child.stdin?.write(msg.data);
          }
        } catch {}
      });

      // Poll for credential files
      const abortController = new AbortController();

      // Cleanup when WebSocket closes (user closed the modal)
      ws.on("close", () => {
        abortController.abort();
        if (cleanup) {
          cleanup().then(() => { cleanup = null; }).catch(() => {});
        }
      });

      const credentialFiles = await authContainerService.pollForCredentials(
        provider,
        abortController.signal,
      );

      if (credentialFiles && Object.keys(credentialFiles).length > 0) {
        await credentialStore.storeOAuthCredentials(userId, provider, credentialFiles);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "auth.success", provider }));
        }
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "auth.timeout", remainingSeconds: 0 }));
      }

      // Cleanup
      if (cleanup) {
        await cleanup();
        cleanup = null;
      }
      if (ws.readyState === WebSocket.OPEN) ws.close();
    } catch (err: any) {
      console.error(`[auth-ws] Error for user ${userId}:`, err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "auth.error", message: err.message }));
        ws.close();
      }
      if (cleanup) await cleanup();
    }
  });

  return {
    wss,
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const match = url.pathname.match(/^\/api\/auth\/terminal\/(\w+)$/);
      if (!match) {
        socket.destroy();
        return;
      }

      const provider = match[1];
      if (!VALID_PROVIDERS.has(provider)) {
        socket.destroy();
        return;
      }

      const ticket = url.searchParams.get("ticket");
      if (!ticket) {
        socket.destroy();
        return;
      }

      const userId = consumeWsTicket(ticket);
      if (!userId) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, userId, provider);
      });
    },
  };
}
