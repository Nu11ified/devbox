/**
 * Programmatic hooks for the Claude Agent SDK.
 *
 * Hooks are callback functions that intercept tool execution, subagent dispatch,
 * and other agent lifecycle events. They enable audit logging, dangerous command
 * blocking, and real-time event forwarding to the UI.
 */

import type { ProviderEventEnvelope } from "../events.js";
import type { ThreadId, TurnId } from "../types.js";

/** Dangerous shell patterns that should be blocked or flagged. */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /mkfs\./,                   // disk formatting
  /dd\s+if=/,                // raw disk operations
  /:(){ :\|:& };:/,          // fork bomb
  />\s*\/dev\/sd/,           // write to raw device
  /curl.*\|\s*sh/,           // pipe to shell
  /wget.*\|\s*sh/,           // pipe to shell
  /chmod\s+777/,             // world-writable
  /--force\s+push/,          // force push
  /git\s+push.*--force/,     // force push
];

/** File paths that should not be modified. */
const PROTECTED_PATHS = [
  /^\/etc\//,
  /^\/usr\//,
  /^\/boot\//,
  /^\/sys\//,
  /^\/proc\//,
  /\.env$/,
  /credentials/i,
  /secrets?\.ya?ml$/i,
];

export interface HookContext {
  threadId: ThreadId;
  turnId: TurnId;
  enqueue: (envelope: ProviderEventEnvelope) => Promise<void>;
  makeEnvelope: (
    type: ProviderEventEnvelope["type"],
    threadId: ThreadId,
    payload: any,
    turnId?: TurnId,
  ) => ProviderEventEnvelope;
}

/**
 * Creates programmatic hooks for the SDK query() call.
 * Returns a hooks object conforming to the SDK's hooks option.
 */
export function createAgentHooks(ctx: HookContext) {
  return {
    /**
     * PreToolUse hooks run before a tool executes.
     * Return {} to allow, or { hookSpecificOutput } to modify/block.
     */
    PreToolUse: [
      async (event: { tool_name: string; tool_input: Record<string, any> }) => {
        const { tool_name, tool_input } = event;

        // Audit log every tool use
        console.log(`[hooks] PreToolUse: ${tool_name} thread=${ctx.threadId}`);

        // Block dangerous shell commands
        if (tool_name === "Bash" && typeof tool_input.command === "string") {
          for (const pattern of DANGEROUS_PATTERNS) {
            if (pattern.test(tool_input.command)) {
              console.warn(
                `[hooks] BLOCKED dangerous command: ${tool_input.command.slice(0, 100)} thread=${ctx.threadId}`
              );

              // Notify UI about blocked command
              await ctx.enqueue(
                ctx.makeEnvelope("runtime.warning", ctx.threadId, {
                  message: `Blocked dangerous command: ${tool_input.command.slice(0, 80)}...`,
                }, ctx.turnId)
              );

              return {
                hookSpecificOutput: {
                  permissionDecision: "deny",
                  reason: `Command matches dangerous pattern: ${pattern.source}`,
                },
              };
            }
          }
        }

        // Protect sensitive file paths for Write/Edit
        if (
          (tool_name === "Write" || tool_name === "Edit") &&
          typeof tool_input.file_path === "string"
        ) {
          for (const pattern of PROTECTED_PATHS) {
            if (pattern.test(tool_input.file_path)) {
              console.warn(
                `[hooks] BLOCKED write to protected path: ${tool_input.file_path} thread=${ctx.threadId}`
              );
              return {
                hookSpecificOutput: {
                  permissionDecision: "deny",
                  reason: `Cannot modify protected path: ${tool_input.file_path}`,
                },
              };
            }
          }
        }

        // Allow all other tool uses
        return {};
      },
    ],

    /**
     * PostToolUse hooks run after a tool completes.
     * Used for analytics and result tracking.
     */
    PostToolUse: [
      async (event: {
        tool_name: string;
        tool_input: Record<string, any>;
        tool_result?: any;
      }) => {
        // Track tool execution for analytics
        console.log(
          `[hooks] PostToolUse: ${event.tool_name} completed thread=${ctx.threadId}`
        );
        return {};
      },
    ],

    /**
     * Notification hooks receive messages from the agent.
     * Forward them to the UI as runtime warnings.
     */
    Notification: [
      async (event: { message: string }) => {
        await ctx.enqueue(
          ctx.makeEnvelope("runtime.warning", ctx.threadId, {
            message: event.message,
          }, ctx.turnId)
        );
        return {};
      },
    ],

    /**
     * SubagentStart fires when a subagent is launched.
     * Log and notify the UI.
     */
    SubagentStart: [
      async (event: { agent_name?: string; prompt?: string }) => {
        console.log(
          `[hooks] SubagentStart: ${event.agent_name ?? "unnamed"} thread=${ctx.threadId}`
        );
        await ctx.enqueue(
          ctx.makeEnvelope("item.started", ctx.threadId, {
            turnId: ctx.turnId,
            itemId: `subagent-${Date.now()}`,
            toolName: `Agent:${event.agent_name ?? "subagent"}`,
            toolCategory: "dynamic_tool_call",
            input: { agent: event.agent_name, prompt: event.prompt?.slice(0, 200) },
          }, ctx.turnId)
        );
        return {};
      },
    ],

    /**
     * SubagentStop fires when a subagent completes.
     */
    SubagentStop: [
      async (event: { agent_name?: string }) => {
        console.log(
          `[hooks] SubagentStop: ${event.agent_name ?? "unnamed"} thread=${ctx.threadId}`
        );
        return {};
      },
    ],

    /**
     * PreCompact fires before the SDK compacts conversation context.
     * Emit a timeline event so users see compaction checkpoints during long runs.
     */
    PreCompact: [
      async (_event: Record<string, unknown>) => {
        console.log(`[hooks] PreCompact: context compaction starting thread=${ctx.threadId}`);
        await ctx.enqueue(
          ctx.makeEnvelope("context.compacted", ctx.threadId, {
            turnId: ctx.turnId,
            message: "Context compacted — conversation summarized to free up context window",
          }, ctx.turnId)
        );
        return {};
      },
    ],

    /**
     * Stop hook fires when the agent decides to stop.
     * Return { stop: false } to override and continue.
     */
    Stop: [
      async (_event: { reason?: string }) => {
        // Allow the agent to stop normally
        return {};
      },
    ],
  };
}
