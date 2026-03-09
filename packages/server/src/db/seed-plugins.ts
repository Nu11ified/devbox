import prisma from "./prisma.js";

const BUILT_IN_PLUGINS = [
  {
    slug: "code-reviewer",
    name: "Code Reviewer",
    description: "Reviews code for bugs, security vulnerabilities, logic errors, and adherence to best practices. Provides confidence-rated findings.",
    author: "Patchwork",
    category: "quality",
    icon: "🔍",
    tags: ["review", "quality", "security", "bugs"],
    instructions: `# Code Review Plugin

When reviewing code, follow this systematic approach:

1. **Security First** — Check for injection vulnerabilities (SQL, XSS, command), authentication/authorization issues, secrets in code, and OWASP Top 10.
2. **Logic Errors** — Trace data flow, check edge cases, verify error handling, look for off-by-one errors and race conditions.
3. **Code Quality** — Check naming conventions, DRY violations, complexity, and readability.
4. **Performance** — Look for N+1 queries, unnecessary allocations, missing indexes, and inefficient algorithms.

Rate each finding with confidence (high/medium/low). Only report high-confidence issues unless asked for a thorough review.

Format findings as:
- **[SEVERITY]** Description (file:line) — Confidence: HIGH/MEDIUM`,
  },
  {
    slug: "tdd-helper",
    name: "TDD Workflow",
    description: "Enforces test-driven development: write failing tests first, then implement the minimal code to pass, then refactor. Never skip the red-green-refactor cycle.",
    author: "Patchwork",
    category: "workflow",
    icon: "🧪",
    tags: ["testing", "tdd", "workflow", "quality"],
    instructions: `# TDD Workflow Plugin

ALWAYS follow the Red-Green-Refactor cycle:

1. **RED** — Write a failing test first that describes the desired behavior. Run it to confirm it fails.
2. **GREEN** — Write the minimum code to make the test pass. No more, no less.
3. **REFACTOR** — Clean up the code while keeping tests green.

Rules:
- Never write implementation code without a failing test first
- Each test should test ONE behavior
- Run tests after every change
- If a bug is found, write a test that reproduces it before fixing
- Prefer small, focused test cases over large integration tests`,
  },
  {
    slug: "git-workflow",
    name: "Git Workflow",
    description: "Smart git operations with conventional commits, branch management, and PR creation best practices.",
    author: "Patchwork",
    category: "workflow",
    icon: "📦",
    tags: ["git", "commits", "workflow", "pr"],
    instructions: `# Git Workflow Plugin

Follow these git conventions:

## Commits
- Use conventional commit format: type(scope): description
- Types: feat, fix, docs, style, refactor, perf, test, chore
- Keep commits atomic — one logical change per commit
- Write descriptive commit messages explaining WHY, not just WHAT

## Branches
- Feature branches: feat/description
- Fix branches: fix/description
- Always branch from main/master

## Pull Requests
- Keep PRs focused and reviewable (< 400 lines when possible)
- Include a clear description with context
- Link related issues`,
  },
  {
    slug: "security-scanner",
    name: "Security Scanner",
    description: "Scans code for OWASP vulnerabilities, exposed secrets, insecure dependencies, and common security anti-patterns.",
    author: "Patchwork",
    category: "security",
    icon: "🛡️",
    tags: ["security", "owasp", "vulnerabilities", "scanning"],
    instructions: `# Security Scanner Plugin

Continuously scan for security issues:

## Check for:
- **Injection** — SQL injection, command injection, XSS, LDAP injection
- **Secrets** — API keys, passwords, tokens in source code or config
- **Authentication** — Weak password policies, missing MFA, session issues
- **Authorization** — Privilege escalation, IDOR, missing access controls
- **Dependencies** — Known CVEs in dependencies, outdated packages
- **Cryptography** — Weak algorithms, hardcoded keys, insecure random
- **Data Exposure** — PII in logs, verbose error messages, debug endpoints

When finding issues, classify by severity (Critical/High/Medium/Low) and provide remediation guidance.`,
  },
  {
    slug: "frontend-design",
    name: "Frontend Design",
    description: "Creates distinctive, production-grade UI with high design quality. Avoids generic AI aesthetics — focuses on craftsmanship and polish.",
    author: "Patchwork",
    category: "frontend",
    icon: "🎨",
    tags: ["ui", "design", "frontend", "css", "react"],
    instructions: `# Frontend Design Plugin

When building UI:

1. **Design Quality** — Aim for production-grade polish. Use consistent spacing, typography scales, and color systems.
2. **Avoid AI Aesthetics** — No generic gradients, no purple-blue defaults, no "modern" clichés. Design with intention.
3. **Component Architecture** — Build composable, reusable components. Use proper prop interfaces.
4. **Responsive** — Mobile-first approach. Test at multiple breakpoints.
5. **Accessibility** — Proper ARIA labels, keyboard navigation, focus management, color contrast.
6. **Performance** — Lazy load images, minimize bundle size, use proper React patterns (memo, useMemo, useCallback where needed).
7. **Animations** — Subtle, purposeful transitions. Prefer CSS transitions over JS animation libraries for simple cases.`,
  },
  {
    slug: "documentation",
    name: "Documentation Generator",
    description: "Auto-generates clear, maintainable documentation including API references, README files, and inline code comments.",
    author: "Patchwork",
    category: "docs",
    icon: "📝",
    tags: ["docs", "readme", "api", "comments"],
    instructions: `# Documentation Plugin

When generating documentation:

1. **README** — Clear project overview, quick start, configuration, and examples
2. **API Docs** — Document all public interfaces, parameters, return types, and error cases
3. **Code Comments** — Only add comments where the logic isn't self-evident. Explain WHY, not WHAT.
4. **Examples** — Include runnable code examples for common use cases
5. **Accuracy** — Never document behavior that doesn't exist. Verify against actual code.
6. **Maintenance** — Write docs that won't rot. Avoid embedding volatile details like version numbers in prose.`,
  },
  {
    slug: "performance-optimizer",
    name: "Performance Optimizer",
    description: "Identifies and fixes performance bottlenecks: N+1 queries, memory leaks, unnecessary re-renders, and algorithmic inefficiencies.",
    author: "Patchwork",
    category: "quality",
    icon: "⚡",
    tags: ["performance", "optimization", "profiling", "speed"],
    instructions: `# Performance Optimizer Plugin

When analyzing performance:

1. **Measure First** — Never optimize without data. Profile before changing code.
2. **Database** — Look for N+1 queries, missing indexes, unnecessary JOINs, large result sets
3. **Memory** — Check for leaks, large allocations, unclosed resources, growing caches
4. **React** — Unnecessary re-renders, missing keys, heavy computations in render
5. **Network** — Reduce payload size, batch requests, use caching headers
6. **Algorithms** — Check time/space complexity, prefer O(n) over O(n²)

Always benchmark before and after changes. Small, measurable improvements compound.`,
  },
  {
    slug: "refactoring-assistant",
    name: "Refactoring Assistant",
    description: "Systematic code refactoring with safety checks. Extracts patterns, reduces duplication, and improves code structure without changing behavior.",
    author: "Patchwork",
    category: "quality",
    icon: "♻️",
    tags: ["refactoring", "cleanup", "patterns", "architecture"],
    instructions: `# Refactoring Assistant Plugin

When refactoring:

1. **Tests First** — Ensure test coverage exists before refactoring. Add tests if needed.
2. **Small Steps** — Make one change at a time. Verify tests pass between each step.
3. **Preserve Behavior** — Refactoring changes structure, not behavior. If behavior changes, it's not a refactoring.
4. **Common Patterns**:
   - Extract Method — Break long functions into named, focused helpers
   - Extract Interface — Decouple implementations from consumers
   - Inline — Remove unnecessary abstractions
   - Rename — Make names reveal intent
   - Move — Put code where it belongs
5. **YAGNI** — Don't add abstractions for hypothetical future needs. Refactor for clarity now.`,
  },
  {
    slug: "debug-helper",
    name: "Debug Helper",
    description: "Systematic debugging methodology: reproduce, isolate, trace root cause, fix, verify. Never guess — always investigate.",
    author: "Patchwork",
    category: "workflow",
    icon: "🐛",
    tags: ["debugging", "troubleshooting", "errors", "investigation"],
    instructions: `# Debug Helper Plugin

Follow systematic debugging:

1. **Read Error Messages** — Don't skip errors. Read stack traces completely. Note line numbers and error codes.
2. **Reproduce** — Can you trigger it reliably? What are the exact steps?
3. **Check Recent Changes** — What changed? Git diff, new deps, config changes.
4. **Trace Root Cause** — Where does the bad value originate? Trace backward through the call stack.
5. **Hypothesis** — State clearly: "I think X is the cause because Y." Test ONE thing at a time.
6. **Fix** — Address root cause, not symptoms. Write a test that reproduces the bug first.
7. **Verify** — Run tests. Confirm the fix works. Check for regressions.

NO FIXES WITHOUT ROOT CAUSE INVESTIGATION. Symptom fixes are failure.`,
  },
  {
    slug: "api-builder",
    name: "API Builder",
    description: "REST and GraphQL API design and implementation following best practices: proper status codes, validation, error handling, and documentation.",
    author: "Patchwork",
    category: "backend",
    icon: "🔌",
    tags: ["api", "rest", "graphql", "backend", "endpoints"],
    instructions: `# API Builder Plugin

When building APIs:

1. **Design First** — Define endpoints, request/response shapes, and error cases before coding
2. **RESTful Conventions** — Proper HTTP methods, status codes, resource naming
3. **Validation** — Validate all input at the boundary. Use schemas (Zod, Joi, etc.)
4. **Error Handling** — Consistent error format with codes, messages, and details
5. **Authentication** — Proper auth middleware, token validation, rate limiting
6. **Documentation** — OpenAPI/Swagger spec or equivalent. Document all endpoints.
7. **Testing** — Integration tests for each endpoint covering happy path and error cases`,
  },
  {
    slug: "typescript-strict",
    name: "TypeScript Strict Mode",
    description: "Enforces strict TypeScript practices: no any, proper generics, discriminated unions, exhaustive pattern matching.",
    author: "Patchwork",
    category: "quality",
    icon: "🔒",
    tags: ["typescript", "types", "strict", "safety"],
    instructions: `# TypeScript Strict Plugin

Enforce strict TypeScript:

1. **No \`any\`** — Use \`unknown\` and narrow with type guards. Every variable should have a meaningful type.
2. **Discriminated Unions** — Model states with tagged unions, not optional fields
3. **Exhaustive Matching** — Handle all cases in switch statements. Use \`never\` for exhaustiveness checks.
4. **Generics** — Use generics for reusable abstractions. Name them descriptively (not just \`T\`).
5. **Readonly** — Default to immutable. Use \`readonly\` arrays and \`Readonly<T>\` where possible.
6. **Null Safety** — Always handle null/undefined. Prefer optional chaining and nullish coalescing.
7. **Return Types** — Explicitly annotate return types on public functions.`,
  },
  {
    slug: "docker-devops",
    name: "Docker & DevOps",
    description: "Docker best practices, CI/CD pipeline design, and infrastructure configuration.",
    author: "Patchwork",
    category: "devops",
    icon: "🐳",
    tags: ["docker", "devops", "ci-cd", "infrastructure"],
    instructions: `# Docker & DevOps Plugin

When working with Docker and infrastructure:

1. **Multi-stage Builds** — Separate build and runtime stages. Keep final images minimal.
2. **Layer Caching** — Order Dockerfile instructions from least to most frequently changed.
3. **Security** — Don't run as root. Scan images for vulnerabilities. Use specific image tags, not \`latest\`.
4. **CI/CD** — Fast feedback loops. Run tests in parallel. Cache dependencies between runs.
5. **Environment Config** — Use env vars for runtime config. Never hardcode secrets.
6. **Health Checks** — Add proper health check endpoints and Docker HEALTHCHECK instructions.
7. **Logging** — Structured JSON logs. Don't log sensitive data.`,
  },
];

export async function seedPlugins(): Promise<void> {
  for (const plugin of BUILT_IN_PLUGINS) {
    await prisma.plugin.upsert({
      where: { slug: plugin.slug },
      update: {
        name: plugin.name,
        description: plugin.description,
        author: plugin.author,
        category: plugin.category,
        icon: plugin.icon,
        tags: plugin.tags,
        instructions: plugin.instructions,
      },
      create: plugin,
    });
  }
  console.log(`[seed] Upserted ${BUILT_IN_PLUGINS.length} built-in plugins`);
}
