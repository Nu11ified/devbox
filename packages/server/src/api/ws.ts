import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getPool } from "../db/queries.js";
import prisma from "../db/prisma.js";

const COOKIE_NAMES = [
  "__Secure-better-auth.session_token",
  "better-auth.session_token",
  "__Secure-better-auth-session_token",
  "better-auth-session_token",
];

function extractSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    for (const name of COOKIE_NAMES) {
      const prefix = name + "=";
      if (cookie.startsWith(prefix)) {
        const raw = decodeURIComponent(cookie.slice(prefix.length));
        // better-auth uses signed cookies: value is "token.hmacSignature"
        // Strip the signature to get the actual session token
        const lastDot = raw.lastIndexOf(".");
        return lastDot > 0 ? raw.slice(0, lastDot) : raw;
      }
    }
  }
  return null;
}

/**
 * Set up WebSocket handling for run event streaming.
 *
 * Handles upgrade requests to /api/runs/:id/stream.
 * On connect, sends existing transcript events, then polls
 * for new events every 500ms and pushes to the client.
 */
export function setupWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/);

    if (!match) {
      // Don't destroy — let other upgrade handlers (e.g. thread-ws) handle it
      return;
    }

    const runId = match[1];

    // Authenticate via session cookie before upgrading
    const token = extractSessionToken(request.headers.cookie);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    let userId: string;
    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });
      if (!session || session.expiresAt < new Date()) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      userId = session.user.id;
    } catch {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      return;
    }

    // Verify run belongs to user
    const db = getPool();
    try {
      const result = await db.query(
        "SELECT created_by FROM runs WHERE id = $1",
        [runId]
      );
      if (
        result.rows.length === 0 ||
        (result.rows[0].created_by && result.rows[0].created_by !== userId)
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    } catch {
      socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, runId);
    });
  });

  wss.on("connection", (ws: WebSocket, _request: unknown, runId: string) => {
    let lastEventId: string | null = null;
    let lastStatus: string | null = null;
    let closed = false;

    const poll = async () => {
      if (closed) return;

      try {
        const db = getPool();

        // Fetch new transcript events since last seen
        let sql: string;
        const params: unknown[] = [runId];

        if (lastEventId) {
          sql = `SELECT * FROM transcript_events
                 WHERE run_id = $1
                 AND created_at > (SELECT created_at FROM transcript_events WHERE id = $2)
                 ORDER BY created_at ASC LIMIT 50`;
          params.push(lastEventId);
        } else {
          sql = `SELECT * FROM transcript_events
                 WHERE run_id = $1
                 ORDER BY created_at ASC LIMIT 50`;
        }

        const eventsResult = await db.query(sql, params);

        for (const event of eventsResult.rows) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "transcript_event", data: event }));
            lastEventId = event.id;
          }
        }

        // Check for status changes
        const statusResult = await db.query(
          "SELECT status FROM runs WHERE id = $1",
          [runId]
        );

        if (statusResult.rows.length > 0) {
          const currentStatus = statusResult.rows[0].status;
          if (currentStatus !== lastStatus) {
            lastStatus = currentStatus;
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "status_change", status: currentStatus }));
            }
          }

          // Stop polling if run is terminal
          if (["completed", "failed", "cancelled"].includes(currentStatus)) {
            if (ws.readyState === WebSocket.OPEN) {
              ws.close(1000, "Run completed");
            }
            return;
          }
        }
      } catch {
        // Silently handle errors during polling
      }

      if (!closed) {
        setTimeout(poll, 500);
      }
    };

    ws.on("close", () => {
      closed = true;
    });

    ws.on("error", () => {
      closed = true;
    });

    // Start polling
    poll();
  });
}
