import type { AgentConfig, AgentEvent, AgentSession } from "@patchwork/shared";
import type { SidecarClient } from "./backend.js";

export interface AgentLoopOptions {
  session: AgentSession;
  events: AsyncIterable<AgentEvent>;
  sidecar: SidecarClient;
  config: AgentConfig;
  recordEvent: (runId: string, event: AgentEvent) => void | Promise<void>;
  collectPatches: () => Promise<unknown[]>;
}

export interface AgentLoopResult {
  eventsProcessed: number;
  toolCallsForwarded: number;
  toolCallsRejected: number;
  exitReason: "done" | "budget_exceeded" | "stream_ended";
}

/**
 * Core agent loop. Iterates over events from an agent backend,
 * forwards allowed tool calls to the sidecar, rejects disallowed ones,
 * and stops on completion or budget signals.
 */
export async function agentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const { session, events, sidecar, config, recordEvent, collectPatches } = opts;
  const allowedTools = new Set(config.allowedTools);

  let eventsProcessed = 0;
  let toolCallsForwarded = 0;
  let toolCallsRejected = 0;
  let exitReason: AgentLoopResult["exitReason"] = "stream_ended";

  for await (const event of events) {
    eventsProcessed++;
    await recordEvent(session.runId, event);

    switch (event.type) {
      case "tool_call": {
        if (!allowedTools.has(event.tool)) {
          toolCallsRejected++;
          break;
        }
        toolCallsForwarded++;
        await forwardToolCall(sidecar, event.tool, event.args);
        break;
      }

      case "done_marker": {
        exitReason = "done";
        await collectPatches();
        return { eventsProcessed, toolCallsForwarded, toolCallsRejected, exitReason };
      }

      case "budget_exceeded": {
        exitReason = "budget_exceeded";
        return { eventsProcessed, toolCallsForwarded, toolCallsRejected, exitReason };
      }

      // message, tool_result, error, raw_pty — just record (already done above)
      default:
        break;
    }
  }

  // Stream ended without explicit done_marker
  await collectPatches();
  return { eventsProcessed, toolCallsForwarded, toolCallsRejected, exitReason };
}

/**
 * Routes a tool call to the appropriate SidecarClient method.
 * Note: SidecarClient.exec is an HTTP call to the sidecar service
 * running inside the devbox container — not a local shell execution.
 */
async function forwardToolCall(
  sidecar: SidecarClient,
  tool: string,
  args: Record<string, unknown>
): Promise<void> {
  switch (tool) {
    case "shell":
      await sidecar.exec(
        String(args.cmd ?? ""),
        Array.isArray(args.args) ? args.args.map(String) : [],
        args.cwd ? String(args.cwd) : undefined
      );
      break;

    case "file_read":
      await sidecar.readFile(String(args.path ?? ""));
      break;

    case "file_write":
      await sidecar.writeFile(String(args.path ?? ""), String(args.content ?? ""));
      break;

    default:
      // Generic tool — forward as sidecar exec call
      await sidecar.exec(tool, Object.values(args).map(String));
      break;
  }
}
