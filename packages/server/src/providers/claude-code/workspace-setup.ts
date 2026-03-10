/**
 * Workspace setup for Claude Agent SDK features.
 *
 * Sets up .claude/ directory structure for skills, slash commands,
 * and project settings that the SDK discovers via settingSources: ["project"].
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ensure the .claude/ directory structure exists in the workspace
 * with default skills and slash commands for Patchwork.
 */
export function setupWorkspaceClaudeConfig(cwd: string, opts?: {
  projectName?: string;
  repo?: string;
  branch?: string;
}): void {
  const claudeDir = join(cwd, ".claude");
  const commandsDir = join(claudeDir, "commands");
  const skillsDir = join(claudeDir, "skills");

  // Create directories
  for (const dir of [claudeDir, commandsDir, skillsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // --- Slash Commands ---

  // /review command
  writeIfNotExists(join(commandsDir, "review.md"), `---
description: Review code changes in the current branch
---

Review all uncommitted changes in this repository.

1. Run \`git diff\` to see all changes
2. For each modified file, analyze the changes for:
   - Correctness and logic errors
   - Security vulnerabilities
   - Performance issues
   - Code style consistency
3. Provide a summary with specific feedback
`);

  // /test command
  writeIfNotExists(join(commandsDir, "test.md"), `---
description: Run tests and analyze results
---

Run the project's test suite and analyze the results.

1. Detect the testing framework (look for jest, vitest, pytest, etc.)
2. Run the full test suite
3. If any tests fail, analyze the failures and suggest fixes
4. Report test coverage if available
`);

  // /commit command
  writeIfNotExists(join(commandsDir, "commit.md"), `---
description: Stage and commit changes with a descriptive message
---

Review all changes and create a well-structured git commit.

1. Run \`git status\` and \`git diff\` to review changes
2. Stage relevant files (avoid committing .env, credentials, etc.)
3. Write a concise commit message following conventional commits format
4. Create the commit
`);

  // /pr command
  writeIfNotExists(join(commandsDir, "pr.md"), `---
description: Prepare changes for a pull request
---

Prepare the current changes for a pull request.

1. Review all changes since branching from the base branch
2. Ensure all tests pass
3. Write a PR description summarizing changes
4. List any breaking changes or migration steps needed
`);

  // /fix command with argument
  writeIfNotExists(join(commandsDir, "fix.md"), `---
description: Fix a specific issue or bug
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

Fix the following issue: $ARGUMENTS

1. Understand the issue being described
2. Search the codebase for relevant code
3. Implement the fix with minimal changes
4. Verify the fix doesn't break existing tests
`);

  // --- Skills ---

  // Project context skill
  const projectContext = opts?.projectName
    ? `This is the ${opts.projectName} project${opts.repo ? ` (${opts.repo})` : ""}.`
    : "This is a Patchwork-managed project.";

  writeIfNotExists(join(skillsDir, "project-context.md"), `---
name: project-context
description: Understanding of the current project context and conventions
---

# Project Context

${projectContext}
${opts?.branch ? `Main branch: ${opts.branch}` : ""}

## Conventions
- Follow existing code patterns and naming conventions
- Write tests for new functionality
- Keep commits focused and well-described
- Don't modify .env files or committed secrets
`);

  // Code quality skill
  writeIfNotExists(join(skillsDir, "code-quality.md"), `---
name: code-quality
description: Code quality standards and best practices for this project
---

# Code Quality Standards

## General
- Follow existing patterns in the codebase
- Keep functions focused (single responsibility)
- Use meaningful names for variables, functions, and files
- Add comments only where logic isn't self-evident

## Security
- Never hardcode secrets or credentials
- Validate user input at system boundaries
- Use parameterized queries for database operations
- Sanitize output to prevent XSS

## Testing
- Write tests for new features and bug fixes
- Test edge cases and error conditions
- Keep tests focused and independent
`);

  // --- Settings ---

  // Write .claude/settings.json if not present
  writeIfNotExists(join(claudeDir, "settings.json"), JSON.stringify({
    permissions: {
      // Default to allowing common read operations
      allow: ["Read", "Glob", "Grep", "LS"],
    },
  }, null, 2));
}

function writeIfNotExists(filePath: string, content: string): void {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, "utf-8");
  }
}
