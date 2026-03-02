import type {
  AgentBackend,
  AgentConfig,
  AgentEvent,
  AgentSession,
} from "@patchwork/shared";
import type { SidecarClient } from "./backend.js";
import { randomUUID } from "node:crypto";

// Thin interface for the Codex SDK — real dependency not installed
export interface CodexSDK {
  createThread(options: {
    workingDirectory: string;
  }): Promise<{ threadId: string }>;
  runStreamed(threadId: string, prompt: string): AsyncIterable<CodexEvent>;
  abort(threadId: string): Promise<void>;
}

export type CodexEvent =
  | { type: "message"; content: string }
  | { type: "tool_call"; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: unknown }
  | { type: "turn.completed" };

/**
 * CodexBackend implements AgentBackend using the OpenAI Codex SDK.
 * Since the real SDK is not installed, it works against a CodexSDK interface
 * that can be satisfied by the real SDK or a mock.
 */
export class CodexBackend implements AgentBackend {
  readonly type = "codex" as const;

  private sdk: CodexSDK;
  private sidecar: SidecarClient;
  private eventStreams = new Map<string, AsyncIterable<AgentEvent>>();

  constructor(sdk: CodexSDK, sidecar: SidecarClient) {
    this.sdk = sdk;
    this.sidecar = sidecar;
  }

  async startSession(
    devboxId: string,
    config: AgentConfig
  ): Promise<AgentSession> {
    const { threadId } = await this.sdk.createThread({
      workingDirectory: "/workspace",
    });

    return {
      id: threadId,
      runId: randomUUID(),
      devboxId,
      config,
      threadId,
    };
  }

  async sendTask(session: AgentSession, prompt: string): Promise<void> {
    const threadId = session.id;
    const formattedPrompt = this.formatPrompt(prompt, session.config);
    const codexEvents = this.sdk.runStreamed(threadId, formattedPrompt);

    // Create and store the mapped event stream
    const agentEvents = this.mapCodexEvents(codexEvents);
    this.eventStreams.set(session.id, agentEvents);
  }

  events(session: AgentSession): AsyncIterable<AgentEvent> {
    const stream = this.eventStreams.get(session.id);
    if (!stream) {
      throw new Error(
        `No event stream for session ${session.id}. Call sendTask first.`
      );
    }
    return stream;
  }

  async terminate(session: AgentSession): Promise<void> {
    this.eventStreams.delete(session.id);
    await this.sdk.abort(session.id);
  }

  private formatPrompt(prompt: string, config: AgentConfig): string {
    return [
      prompt,
      "",
      "--- Patchwork Constraints ---",
      `Role: ${config.role}`,
      "Generate a git patch using git diff. Save to /workspace/patches/.",
      "Do not commit directly.",
    ].join("\n");
  }

  private async *mapCodexEvents(
    codexEvents: AsyncIterable<CodexEvent>
  ): AsyncIterable<AgentEvent> {
    for await (const event of codexEvents) {
      switch (event.type) {
        case "message":
          yield { type: "message", content: event.content };
          break;

        case "tool_call":
          yield {
            type: "tool_call",
            tool: event.name,
            args: event.arguments,
          };
          break;

        case "tool_result":
          yield {
            type: "tool_result",
            tool: event.name,
            result: event.output,
          };
          break;

        case "turn.completed":
          yield { type: "done_marker" };
          break;
      }
    }
  }
}
