import type { BlueprintDefinition } from "@patchwork/shared";

/**
 * Writer-Reviewer: Two-agent blueprint.
 *
 * Flow: implement (claude) → review (codex) → apply_fixes → merge
 *
 * The writer (Claude) implements the feature, then the reviewer (Codex)
 * reviews the code. If the reviewer finds issues, the apply_fixes agent
 * addresses them and loops back for another review. On approval, the
 * changes are merged.
 */
export const WRITER_REVIEWER_BLUEPRINT: BlueprintDefinition = {
  id: "writer-reviewer",
  name: "Writer + Reviewer",
  version: 1,
  description:
    "Two-agent pattern: writer (Claude) implements, reviewer (Codex) validates, fixes loop back if needed",
  nodes: [
    {
      id: "implement",
      type: "agent",
      label: "Implement",
      agentConfig: {
        preferredBackends: ["claude"],
        role: "implementer",
        promptTemplate: "{{task_description}}",
        systemContextTemplate:
          "You are an expert software engineer. Implement the task in {{repo}} on branch {{branch}}. Write clean, well-tested code.",
        allowedTools: ["shell", "file_read", "file_write", "grep", "glob"],
        budget: { maxTimeSeconds: 600 },
      },
    },
    {
      id: "review",
      type: "agent",
      label: "Review",
      agentConfig: {
        preferredBackends: ["codex", "claude"],
        role: "reviewer",
        promptTemplate:
          "Review the implementation of: {{task_description}}\n\nIf changes are needed, list them clearly. If the code is correct and complete, approve it.",
        systemContextTemplate:
          "You are a code reviewer for {{repo}}. Check for bugs, security issues, test coverage, and code quality. Only read files — do not modify anything.",
        allowedTools: ["file_read", "grep", "glob"],
        budget: { maxTimeSeconds: 180 },
      },
      retryPolicy: { maxRetries: 3, backoffMs: 0 },
    },
    {
      id: "apply_fixes",
      type: "agent",
      label: "Apply Fixes",
      agentConfig: {
        preferredBackends: ["claude"],
        role: "ci_fixer",
        promptTemplate:
          "Apply the review feedback to fix issues found in the implementation of: {{task_description}}",
        systemContextTemplate:
          "You are fixing code based on review feedback in {{repo}}. Only fix the issues mentioned — do not refactor or change unrelated code.",
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
    { from: "implement", to: "review", condition: "always" },
    { from: "review", to: "merge", condition: "on_success" },
    { from: "review", to: "apply_fixes", condition: "on_failure" },
    { from: "apply_fixes", to: "review", condition: "always" },
  ],
};
