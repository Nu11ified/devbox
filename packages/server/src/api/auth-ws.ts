import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import Docker from "dockerode";
import type { CredentialStore } from "../auth/credential-store.js";
import type { AuthContainerService } from "../auth/auth-container.js";
import { consumeWsTicket } from "../auth/ws-tickets.js";

const VALID_PROVIDERS = new Set(["claude", "codex"]);

export function setupAuthWebSocket(
  credentialStore: CredentialStore,
  authContainerService: AuthContainerService,
) {
  const wss = new WebSocketServer({ noServer: true });
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage, userId: string, provider: string) => {
    let cleanup: (() => Promise<void>) | null = null;

    try {
      // Spawn auth container
      const result = await authContainerService.spawnAuthContainer(userId, provider);
      cleanup = result.cleanup;
      const containerId = result.containerId;

      ws.send(JSON.stringify({ type: "auth.ready", containerId }));

      // Attach to container PTY
      const container = docker.getContainer(containerId);
      const attachStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      });

      // Container stdout → WebSocket
      attachStream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: chunk.toString() }));
        }
      });

      // WebSocket → Container stdin
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "data" && msg.data) {
            attachStream.write(msg.data);
          }
        } catch {}
      });

      // Poll for credential files
      const abortController = new AbortController();

      // Abort polling if WebSocket closes
      ws.on("close", () => {
        abortController.abort();
      });

      const credentialFiles = await authContainerService.pollForCredentials(
        containerId,
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
