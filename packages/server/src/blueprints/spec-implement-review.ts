import type { BlueprintDefinition } from "@patchwork/shared";

/**
 * Spec-Implement-Review: Three-agent blueprint.
 *
 * Flow: spec_write (claude) → implement (codex) → review (claude) → merge
 *
 * A spec writer (Claude) creates a detailed specification, an implementer
 * (Codex) follows the spec to produce code, and a reviewer (Claude)
 * validates the result against the spec. If the review fails, the
 * implementer can be re-invoked to fix issues.
 */
export const SPEC_IMPLEMENT_REVIEW_BLUEPRINT: BlueprintDefinition = {
  id: "spec-implement-review",
  name: "Spec → Implement → Review",
  version: 1,
  description:
    "Three-agent pattern: spec writer (Claude) creates spec, implementer (Codex) codes, reviewer (Claude) validates",
  nodes: [
    {
      id: "spec_write",
      type: "agent",
      label: "Write Spec",
      agentConfig: {
        preferredBackends: ["claude"],
        role: "spec_writer",
        promptTemplate:
          "Write a detailed technical specification for: {{task_description}}\n\nInclude: requirements, acceptance criteria, implementation approach, edge cases, and test plan.",
        systemContextTemplate:
          "You are a technical architect for {{repo}}. Write a clear, detailed spec that an implementer can follow. Output the spec to /workspace/spec.md.",
        allowedTools: ["file_read", "file_write", "grep", "glob"],
        budget: { maxTimeSeconds: 300 },
      },
    },
    {
      id: "implement",
      type: "agent",
      label: "Implement",
      agentConfig: {
        preferredBackends: ["codex", "claude"],
        role: "implementer",
        promptTemplate:
          "Implement the feature described in /workspace/spec.md for: {{task_description}}\n\nFollow the spec exactly. Write tests for all acceptance criteria.",
        systemContextTemplate:
          "You are a software engineer implementing a feature in {{repo}} on branch {{branch}}. Read /workspace/spec.md first, then implement exactly what it describes.",
        allowedTools: ["shell", "file_read", "file_write", "grep", "glob"],
        budget: { maxTimeSeconds: 600 },
      },
    },
    {
      id: "review",
      type: "agent",
      label: "Review",
      agentConfig: {
        preferredBackends: ["claude"],
        role: "reviewer",
        promptTemplate:
          "Review the implementation against the spec in /workspace/spec.md for: {{task_description}}\n\nVerify all acceptance criteria are met. If changes are needed, list them clearly.",
        systemContextTemplate:
          "You are a code reviewer for {{repo}}. Compare the implementation against /workspace/spec.md. Check correctness, completeness, and code quality. Only read files — do not modify anything.",
        allowedTools: ["file_read", "grep", "glob"],
        budget: { maxTimeSeconds: 180 },
      },
      retryPolicy: { maxRetries: 2, backoffMs: 0 },
    },
    {
      id: "fix",
      type: "agent",
      label: "Fix Issues",
      agentConfig: {
        preferredBackends: ["codex", "claude"],
        role: "ci_fixer",
        promptTemplate:
          "Fix the issues found during review of: {{task_description}}\n\nRefer to /workspace/spec.md for requirements.",
        systemContextTemplate:
          "You are fixing code based on review feedback in {{repo}}. Follow the spec in /workspace/spec.md. Only fix the issues mentioned — do not refactor unrelated code.",
        allowedTools: ["shell", "file_read", "file_write"],
        budget: { maxTimeSeconds: 300 },
      },
    },
    {
      id: "merge",
      type: "deterministic",
      label: "Merge",
      command: "echo merge-patches",
    },
  ],
  edges: [
    { from: "spec_write", to: "implement", condition: "always" },
    { from: "implement", to: "review", condition: "always" },
    { from: "review", to: "merge", condition: "on_success" },
    { from: "review", to: "fix", condition: "on_failure" },
    { from: "fix", to: "review", condition: "always" },
  ],
};
