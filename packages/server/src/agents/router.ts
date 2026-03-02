import type { AgentBackend, TaskSpec } from "@patchwork/shared";

const ROLE_DEFAULTS: Record<string, string> = {
  implementer: "claude",
  reviewer: "codex",
  ci_fixer: "claude",
  spec_writer: "claude",
};

const PYTHON_PATTERN = /\bpython\b/i;

/**
 * AgentRouter selects the appropriate agent backend based on
 * user preferences, role defaults, and language detection.
 */
export class AgentRouter {
  private backends: Map<string, AgentBackend>;

  constructor(backends: Map<string, AgentBackend>) {
    this.backends = new Map(backends);
  }

  selectBackend(taskSpec: TaskSpec, role: string): AgentBackend {
    if (this.backends.size === 0) {
      throw new Error("No agent backends available");
    }

    // 1. User-specified preference takes priority
    if (taskSpec.preferredBackend && taskSpec.preferredBackend !== "auto") {
      const preferred = this.backends.get(taskSpec.preferredBackend);
      if (preferred) return preferred;
    }

    // 2. Language detection: Python tasks prefer codex
    if (PYTHON_PATTERN.test(taskSpec.description)) {
      const codex = this.backends.get("codex");
      if (codex) return codex;
    }

    // 3. Role-based defaults
    const defaultName = ROLE_DEFAULTS[role];
    if (defaultName) {
      const defaultBackend = this.backends.get(defaultName);
      if (defaultBackend) return defaultBackend;
    }

    // 4. Fallback: first available
    return this.backends.values().next().value!;
  }

  registerBackend(name: string, backend: AgentBackend): void {
    this.backends.set(name, backend);
  }

  getAvailableBackends(): string[] {
    return Array.from(this.backends.keys());
  }
}
