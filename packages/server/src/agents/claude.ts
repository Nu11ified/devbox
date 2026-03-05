import type {
  AgentBackend,
  AgentConfig,
  AgentEvent,
  AgentSession,
} from "@patchwork/shared";
import type { SidecarHttpClient } from "./sidecar-client.js";
import { randomUUID } from "node:crypto";
import type WebSocket from "ws";

const DONE_MARKER = "PATCHWORK_DONE";

interface PtyMessage {
  type: "data" | "exit";
  data?: string;
  timestamp?: number;
  exitCode?: number;
}

/**
 * ClaudeBackend runs Claude Code inside devbox containers via PTY.
 * It communicates with the sidecar's PTY management endpoints.
 */
export class ClaudeBackend implements AgentBackend {
  readonly type = "claude" as const;

  private wsFactory: (url: string) => WebSocket;
  private sidecar: SidecarHttpClient;
  private wsConnections = new Map<string, WebSocket>();
  private eventStreams = new Map<string, AsyncIterable<AgentEvent>>();

  constructor(
    sidecar: SidecarHttpClient,
    wsFactory?: (url: string) => WebSocket
  ) {
    this.sidecar = sidecar;
    this.wsFactory =
      wsFactory ?? ((url: string) => new (require("ws"))(url) as WebSocket);
  }

  async startSession(
    devboxId: string,
    config: AgentConfig
  ): Promise<AgentSession> {
    const args = ["--dangerously-skip-permissions"];
    if ((config as any).useSubscription) {
      args.push("--subscription");
    }
    const { sessionId } = await this.sidecar.ptyStart("claude", args);

    const wsUrl = this.sidecar.url.replace(/^http/, "ws");
    const ws = this.wsFactory(`${wsUrl}/pty/stream?id=${sessionId}`);
    this.wsConnections.set(sessionId, ws);

    return {
      id: sessionId,
      runId: randomUUID(),
      devboxId,
      config,
      ptySessionId: sessionId,
    };
  }

  async sendTask(session: AgentSession, prompt: string): Promise<void> {
    const formattedPrompt = this.formatPrompt(prompt, session.config);
    await this.sidecar.ptyWrite(session.id, formattedPrompt);
  }

  events(session: AgentSession): AsyncIterable<AgentEvent> {
    // If we already created a stream for this session (from sendTask), return it
    if (this.eventStreams.has(session.id)) {
      return this.eventStreams.get(session.id)!;
    }

    const ws = this.wsConnections.get(session.id);
    if (!ws) {
      throw new Error(`No WebSocket connection for session ${session.id}`);
    }

    const timeoutMs = session.config.budget.maxTimeSeconds * 1000;
    const stream = this.createEventStream(ws, timeoutMs);
    this.eventStreams.set(session.id, stream);
    return stream;
  }

  async terminate(session: AgentSession): Promise<void> {
    const ws = this.wsConnections.get(session.id);
    if (ws && ws.readyState === 1) {
      ws.close();
    }
    this.wsConnections.delete(session.id);
    this.eventStreams.delete(session.id);
    await this.sidecar.ptyKill(session.id);
  }

  private formatPrompt(prompt: string, config: AgentConfig): string {
    return [
      prompt,
      "",
      "--- Patchwork Constraints ---",
      `Role: ${config.role}`,
      "Generate a git patch using git diff. Save to /workspace/patches/.",
      "Do not commit directly.",
      `When tests pass and patch is saved, output ${DONE_MARKER}.`,
    ].join("\n");
  }

  private createEventStream(
    ws: WebSocket,
    timeoutMs: number
  ): AsyncIterable<AgentEvent> {
    const buffer: AgentEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const push = (event: AgentEvent) => {
      buffer.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const finish = () => {
      done = true;
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    // Set up timeout
    const timer = setTimeout(() => {
      push({ type: "budget_exceeded", reason: "time" });
      finish();
    }, timeoutMs);

    ws.on("message", (raw: unknown) => {
      try {
        const msg: PtyMessage = JSON.parse(String(raw));

        if (msg.type === "data" && msg.data !== undefined) {
          push({
            type: "raw_pty",
            data: msg.data,
            timestamp: msg.timestamp ?? Date.now(),
          });

          // Check for done marker in output
          if (msg.data.includes(DONE_MARKER)) {
            push({ type: "done_marker" });
            clearTimeout(timer);
            finish();
          }
        } else if (msg.type === "exit") {
          if (msg.exitCode !== 0 && msg.exitCode !== undefined) {
            push({
              type: "error",
              message: `PTY process exited with exit code ${msg.exitCode}`,
            });
          }
          push({ type: "done_marker" });
          clearTimeout(timer);
          finish();
        }
      } catch {
        // Non-JSON messages — treat as raw data
        push({
          type: "raw_pty",
          data: String(raw),
          timestamp: Date.now(),
        });
      }
    });

    ws.on("close", () => {
      clearTimeout(timer);
      if (!done) {
        push({ type: "done_marker" });
        finish();
      }
    });

    ws.on("error", (err: Error) => {
      push({ type: "error", message: err.message });
      clearTimeout(timer);
      finish();
    });

    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<AgentEvent>> {
            while (buffer.length === 0 && !done) {
              await new Promise<void>((r) => {
                resolve = r;
              });
            }
            if (buffer.length > 0) {
              return { value: buffer.shift()!, done: false };
            }
            return { value: undefined as unknown as AgentEvent, done: true };
          },
        };
      },
    };
  }
}
