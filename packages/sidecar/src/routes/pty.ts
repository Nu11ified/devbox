import { Router } from "express";
import { WebSocketServer } from "ws";
import type { Server } from "node:http";
import { PtyManager } from "../pty-manager.js";

const router = Router();
const manager = new PtyManager();

// POST /pty/start — create session
router.post("/pty/start", (req, res) => {
  const { id, cmd = "bash", args = [], cwd, cols, rows } = req.body;
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    manager.start(id, cmd, args, cwd, cols, rows);
    res.json({ sessionId: id });
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

// POST /pty/write — send data to session stdin
router.post("/pty/write", (req, res) => {
  const { id, data } = req.body;
  const session = manager.get(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  session.write(data);
  res.json({ success: true });
});

// POST /pty/resize — resize terminal
router.post("/pty/resize", (req, res) => {
  const { id, cols, rows } = req.body;
  const session = manager.get(id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  session.resize(cols, rows);
  res.json({ success: true });
});

// POST /pty/kill — kill session
router.post("/pty/kill", (req, res) => {
  const { id } = req.body;
  const destroyed = manager.destroy(id);
  if (!destroyed) {
    // Already exited or never existed — still report success
    res.json({ success: true });
    return;
  }
  res.json({ success: true });
});

// Attach WebSocket server for PTY streaming
export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url!, `http://${request.headers.host}`);
    if (url.pathname !== "/pty/stream") {
      socket.destroy();
      return;
    }

    const sessionId = url.searchParams.get("id");
    if (!sessionId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const session = manager.get(sessionId);
      if (!session) {
        ws.send(
          JSON.stringify({ type: "error", error: "Session not found" })
        );
        ws.close();
        return;
      }

      session.onData((data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              type: "data",
              data,
              timestamp: Date.now(),
            })
          );
        }
      });

      session.onExit((exitCode) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "exit", exitCode }));
          ws.close();
        }
      });

      ws.on("close", () => {
        // Client disconnected — session stays alive
      });
    });
  });
}

export { manager as ptyManager };
export default router;
