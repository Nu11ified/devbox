import type { Blueprint } from "./types.js";

const featureDevBlueprint: Blueprint = {
  id: "feature-dev",
  name: "Feature Development",
  description:
    "End-to-end cycle for implementing a new feature with TDD: spec → plan → tests → implementation → quality gates → review → commit.",
  trigger: {
    keywords: ["feature", "add", "implement", "create", "build", "enhance", "refactor"],
  },
  nodes: [
    {
      id: "spec",
      name: "Specification",
      type: "agentic",
      skipCondition: "isSmallTask",
      prompt:
        "Analyze the requirements and create a detailed specification. Document the expected behaviour, inputs/outputs, edge cases, and acceptance criteria.",
    },
    {
      id: "plan",
      name: "Implementation Plan",
      type: "agentic",
      skipCondition: "isSmallTask",
      prompt:
        "Break down the specification into a concrete implementation plan. Identify files to create or modify, interfaces to define, and the order of changes.",
    },
    {
      id: "write-tests",
      name: "Write Tests",
      type: "agentic",
      prompt:
        "Write failing tests that verify the specification requirements. Cover happy paths, edge cases, and error conditions before writing any implementation code.",
    },
    {
      id: "implement",
      name: "Implement",
      type: "agentic",
      prompt:
        "Implement the minimum code needed to make the tests pass. Follow the implementation plan and keep changes focused on the feature requirements.",
    },
    {
      id: "typecheck",
      name: "TypeScript Typecheck",
      type: "deterministic",
      gate: {
        checks: [{ type: "typecheck", language: "typescript" }],
        onFail: "retry",
      },
    },
    {
      id: "lint",
      name: "Lint",
      type: "deterministic",
      gate: {
        checks: [{ type: "lint", language: "typescript" }],
        onFail: "retry",
      },
    },
    {
      id: "run-tests",
      name: "Run Tests",
      type: "deterministic",
      gate: {
        checks: [{ type: "test", language: "typescript" }],
        onFail: "retry",
      },
    },
    {
      id: "fix",
      name: "Fix Issues",
      type: "agentic",
      maxIterations: 2,
      retryFromNodeId: "typecheck",
      prompt:
        "Fix the issues found by the quality gates. Address type errors, lint violations, and failing tests while keeping the implementation correct.",
    },
    {
      id: "review",
      name: "Self-Review",
      type: "agentic",
      prompt:
        "Self-review the implementation for correctness, edge cases, naming clarity, and adherence to the original specification before committing.",
    },
    {
      id: "commit",
      name: "Commit",
      type: "agentic",
      prompt:
        "Commit the changes with a descriptive commit message that explains what was implemented and why, following the repository's commit conventions.",
    },
  ],
};

const debugBlueprint: Blueprint = {
  id: "debug",
  name: "Debug & Fix",
  description:
    "Systematic cycle for reproducing, isolating, and fixing a bug with regression tests to prevent recurrence.",
  trigger: {
    keywords: ["bug", "fix", "debug", "error", "broken", "crash", "issue", "failing"],
  },
  nodes: [
    {
      id: "reproduce",
      name: "Reproduce",
      type: "agentic",
      prompt:
        "Reproduce the reported bug reliably. Identify the exact conditions, inputs, and environment that trigger the issue.",
    },
    {
      id: "isolate",
      name: "Isolate Root Cause",
      type: "agentic",
      prompt:
        "Isolate the root cause of the bug by tracing the execution path and identifying the exact line or logic that produces the incorrect behaviour.",
    },
    {
      id: "regression-test",
      name: "Write Regression Test",
      type: "agentic",
      prompt:
        "Write a failing regression test that captures the bug. The test must fail before the fix and pass after, preventing future regressions.",
    },
    {
      id: "fix",
      name: "Apply Fix",
      type: "agentic",
      prompt:
        "Apply the minimal targeted fix that resolves the root cause. Avoid unrelated changes to reduce the risk of introducing new issues.",
    },
    {
      id: "typecheck",
      name: "TypeScript Typecheck",
      type: "deterministic",
      gate: {
        checks: [{ type: "typecheck", language: "typescript" }],
        onFail: "retry",
      },
    },
    {
      id: "lint",
      name: "Lint",
      type: "deterministic",
      gate: {
        checks: [{ type: "lint", language: "typescript" }],
        onFail: "retry",
      },
    },
    {
      id: "run-tests",
      name: "Run Tests",
      type: "deterministic",
      gate: {
        checks: [{ type: "test", language: "typescript" }],
        onFail: "retry",
      },
    },
    {
      id: "fix-loop",
      name: "Fix Gate Failures",
      type: "agentic",
      maxIterations: 2,
      retryFromNodeId: "typecheck",
      prompt:
        "Fix the issues found by the quality gates. Resolve type errors, lint violations, and failing tests introduced during the bug fix.",
    },
    {
      id: "review",
      name: "Self-Review",
      type: "agentic",
      prompt:
        "Review the fix for correctness and unintended side effects. Confirm the regression test now passes and no existing tests were broken.",
    },
    {
      id: "commit",
      name: "Commit",
      type: "agentic",
      prompt:
        "Commit the fix with a clear commit message describing the bug, its root cause, and how the fix resolves it.",
    },
  ],
};

const codeReviewBlueprint: Blueprint = {
  id: "code-review",
  name: "Code Review",
  description:
    "Advisory cycle for reviewing a pull request: analyses the diff then runs quality checks and pattern/security reviews, producing a report.",
  trigger: {
    keywords: ["review", "code review", "pr review", "pull request"],
  },
  nodes: [
    {
      id: "analyze-diff",
      name: "Analyse Diff",
      type: "agentic",
      prompt:
        "Analyse the pull request diff to understand the intent, scope, and structure of the changes before running automated checks.",
    },
    {
      id: "typecheck",
      name: "TypeScript Typecheck",
      type: "deterministic",
      gate: {
        checks: [{ type: "typecheck", language: "typescript" }],
        onFail: "notify",
      },
    },
    {
      id: "lint",
      name: "Lint",
      type: "deterministic",
      gate: {
        checks: [{ type: "lint", language: "typescript" }],
        onFail: "notify",
      },
    },
    {
      id: "run-tests",
      name: "Run Tests",
      type: "deterministic",
      gate: {
        checks: [{ type: "test", language: "typescript" }],
        onFail: "notify",
      },
    },
    {
      id: "pattern-review",
      name: "Pattern Review",
      type: "agentic",
      prompt:
        "Review the changes for code quality, design patterns, readability, maintainability, and adherence to the project's conventions.",
    },
    {
      id: "security-review",
      name: "Security Review",
      type: "agentic",
      prompt:
        "Review the changes for potential security issues such as injection vulnerabilities, improper auth checks, data leakage, or unsafe dependencies.",
    },
    {
      id: "report",
      name: "Report",
      type: "agentic",
      prompt:
        "Produce a structured review report summarising findings from all checks. Categorise issues by severity and include actionable recommendations.",
    },
  ],
};

const productionCheckBlueprint: Blueprint = {
  id: "production-check",
  name: "Production Check",
  description:
    "Hard-stop cycle run before a production release: full test suite, type and lint gates, build verification, and a smoke test.",
  trigger: {
    keywords: ["deploy", "production", "release", "pre-deploy", "production check"],
  },
  nodes: [
    {
      id: "full-test-suite",
      name: "Full Test Suite",
      type: "deterministic",
      gate: {
        checks: [{ type: "test", language: "typescript" }],
        onFail: "block",
      },
    },
    {
      id: "typecheck",
      name: "TypeScript Typecheck",
      type: "deterministic",
      gate: {
        checks: [{ type: "typecheck", language: "typescript" }],
        onFail: "block",
      },
    },
    {
      id: "lint",
      name: "Lint",
      type: "deterministic",
      gate: {
        checks: [{ type: "lint", language: "typescript" }],
        onFail: "block",
      },
    },
    {
      id: "build",
      name: "Build",
      type: "deterministic",
      gate: {
        checks: [{ type: "build", language: "typescript" }],
        onFail: "block",
      },
    },
    {
      id: "smoke-test",
      name: "Smoke Test",
      type: "agentic",
      prompt:
        "Run a quick smoke test to verify the built artefacts start correctly and core end-to-end paths are functional before releasing to production.",
    },
    {
      id: "report",
      name: "Release Report",
      type: "agentic",
      prompt:
        "Generate a pre-release report summarising the results of all checks. Confirm that all gates passed and the build is ready for deployment.",
    },
  ],
};

const ALL_BLUEPRINTS: Blueprint[] = [
  featureDevBlueprint,
  debugBlueprint,
  codeReviewBlueprint,
  productionCheckBlueprint,
];

export function getBlueprint(id: string): Blueprint | undefined {
  return ALL_BLUEPRINTS.find((bp) => bp.id === id);
}

export function getAllBlueprints(): Blueprint[] {
  return ALL_BLUEPRINTS;
}
