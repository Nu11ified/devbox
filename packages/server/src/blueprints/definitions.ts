import type { BlueprintDefinition } from "@patchwork/shared";

/**
 * Built-in blueprint definitions expressed as JSON.
 */

export const SIMPLE_BLUEPRINT: BlueprintDefinition = {
  id: "simple",
  name: "Simple (3-step)",
  version: 1,
  description: "Basic workflow: implement → lint → review",
  nodes: [
    {
      id: "implement",
      type: "agent",
      label: "Implement",
      agentConfig: {
        preferredBackends: ["claude", "codex"],
        role: "implementer",
        promptTemplate: "{{task_description}}",
        systemContextTemplate:
          "You are an expert software engineer. Implement the task in {{repo}} on branch {{branch}}. Write clean, tested code.",
        allowedTools: ["shell", "file_read", "file_write"],
        budget: { maxTimeSeconds: 300 },
      },
    },
    {
      id: "lint",
      type: "deterministic",
      label: "Lint",
      command: "npm run lint",
    },
    {
      id: "review",
      type: "agent",
      label: "Review",
      agentConfig: {
        preferredBackends: ["codex", "claude"],
        role: "reviewer",
        promptTemplate: "Review the implementation of: {{task_description}}",
        systemContextTemplate:
          "You are a code reviewer for {{repo}}. Check for bugs, security issues, and code quality. Only read files — do not modify anything.",
        allowedTools: ["file_read", "grep", "glob"],
        budget: { maxTimeSeconds: 120 },
      },
    },
  ],
  edges: [
    { from: "implement", to: "lint", condition: "always" },
    { from: "lint", to: "review", condition: "always" },
  ],
};

export const MINION_BLUEPRINT: BlueprintDefinition = {
  id: "minion",
  name: "Full Minion Pipeline",
  version: 1,
  description:
    "Stripe-style pipeline: checkout → implement → lint loop → test → review → merge → push → CI poll → CI fix → done",
  nodes: [
    {
      id: "checkout",
      type: "deterministic",
      label: "Checkout",
      command: "git checkout {{branch}}",
    },
    {
      id: "implement",
      type: "agent",
      label: "Implement",
      agentConfig: {
        preferredBackends: ["claude", "codex"],
        role: "implementer",
        promptTemplate: "{{task_description}}",
        systemContextTemplate:
          "You are an expert software engineer implementing a feature. Write clean, tested code. Repository: {{repo}}, Branch: {{branch}}.",
        allowedTools: ["file_read", "file_write", "shell", "grep", "glob"],
        budget: { maxTimeSeconds: 600 },
      },
    },
    {
      id: "lint_check",
      type: "deterministic",
      label: "Lint Check",
      command: "npm run lint",
      retryPolicy: { maxRetries: 3, backoffMs: 0 },
    },
    {
      id: "lint_fix",
      type: "agent",
      label: "Fix Lint",
      agentConfig: {
        preferredBackends: ["codex", "claude"],
        role: "ci_fixer",
        promptTemplate: "Fix lint errors only. Do not change behavior.",
        systemContextTemplate: "Fix lint errors only. Do not change behavior or refactor.",
        allowedTools: ["file_read", "file_write"],
        budget: { maxTimeSeconds: 120 },
      },
    },
    {
      id: "test",
      type: "deterministic",
      label: "Test",
      command: "npm run test",
    },
    {
      id: "review",
      type: "agent",
      label: "Review",
      agentConfig: {
        preferredBackends: ["codex", "claude"],
        role: "reviewer",
        promptTemplate: "Review the implementation of: {{task_description}}",
        systemContextTemplate:
          "You are a code reviewer for {{repo}}. Check for bugs, security issues, and code quality. Only read files — do not modify anything.",
        allowedTools: ["file_read", "grep", "glob"],
        budget: { maxTimeSeconds: 180 },
      },
    },
    {
      id: "merge",
      type: "deterministic",
      label: "Merge Patches",
      command: "echo merge-patches",
    },
    {
      id: "push",
      type: "deterministic",
      label: "Push",
      command: "git push origin {{branch}}",
    },
    {
      id: "ci_poll",
      type: "deterministic",
      label: "CI Poll",
      command: "gh run list --limit 1",
      retryPolicy: { maxRetries: 1, backoffMs: 0 },
    },
    {
      id: "ci_fix",
      type: "agent",
      label: "Fix CI",
      agentConfig: {
        preferredBackends: ["claude", "codex"],
        role: "ci_fixer",
        promptTemplate: "Fix the CI failures. Do not refactor.",
        systemContextTemplate:
          "The CI pipeline failed. Fix the failing tests or build errors. Do not refactor or change unrelated code.",
        allowedTools: ["file_read", "file_write", "shell", "grep"],
        budget: { maxTimeSeconds: 300 },
      },
    },
    {
      id: "done",
      type: "deterministic",
      label: "Done",
      command: "echo done",
    },
  ],
  edges: [
    { from: "checkout", to: "implement", condition: "always" },
    { from: "implement", to: "lint_check", condition: "always" },
    { from: "lint_check", to: "test", condition: "on_success" },
    { from: "lint_check", to: "lint_fix", condition: "on_failure" },
    { from: "lint_fix", to: "lint_check", condition: "always" },
    { from: "test", to: "review", condition: "always" },
    { from: "review", to: "merge", condition: "always" },
    { from: "merge", to: "push", condition: "always" },
    { from: "push", to: "ci_poll", condition: "always" },
    { from: "ci_poll", to: "done", condition: "on_success" },
    { from: "ci_poll", to: "ci_fix", condition: "on_failure" },
    { from: "ci_fix", to: "ci_poll", condition: "always" },
  ],
};

export const BUILTIN_BLUEPRINTS = new Map<string, BlueprintDefinition>([
  ["simple", SIMPLE_BLUEPRINT],
  ["minion", MINION_BLUEPRINT],
]);
