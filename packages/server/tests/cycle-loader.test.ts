import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadCustomCycles, validateBlueprint } from "../src/cycles/loader.js";

describe("Custom Cycle Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadCustomCycles", () => {
    it("returns empty array when directory doesn't exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(loadCustomCycles("/workspace")).toEqual([]);
    });

    it("loads valid cycle configs", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["migration.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "migration",
        name: "Migration",
        description: "DB migration",
        trigger: { keywords: ["migrate"] },
        nodes: [
          { id: "plan", name: "Plan", type: "agentic" },
          { id: "commit", name: "Commit", type: "deterministic" },
        ],
      }));

      const cycles = loadCustomCycles("/workspace");
      expect(cycles).toHaveLength(1);
      expect(cycles[0].id).toBe("migration");
    });

    it("skips invalid configs", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["bad.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ id: "bad" })); // missing required fields

      const cycles = loadCustomCycles("/workspace");
      expect(cycles).toEqual([]);
    });

    it("skips configs that collide with hardcoded IDs", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["override.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "feature-dev", // collides!
        name: "Override",
        description: "Trying to override",
        trigger: { keywords: ["test"] },
        nodes: [{ id: "a", name: "A", type: "agentic" }],
      }));

      const cycles = loadCustomCycles("/workspace");
      expect(cycles).toEqual([]);
    });
  });

  describe("validateBlueprint", () => {
    it("rejects missing required fields", () => {
      expect(validateBlueprint({ id: "x" } as any)).not.toBeNull();
    });

    it("rejects duplicate node IDs", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [
          { id: "dup", name: "A", type: "agentic" },
          { id: "dup", name: "B", type: "agentic" },
        ],
      };
      expect(validateBlueprint(bp as any)).toContain("duplicate");
    });

    it("rejects maxIterations out of range", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [{ id: "fix", name: "Fix", type: "agentic", maxIterations: 10 }],
      };
      expect(validateBlueprint(bp as any)).toContain("maxIterations");
    });

    it("rejects retryFromNodeId referencing non-existent node", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [{ id: "fix", name: "Fix", type: "agentic", retryFromNodeId: "missing" }],
      };
      expect(validateBlueprint(bp as any)).toContain("retryFromNodeId");
    });

    it("accepts valid blueprint", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [
          { id: "do", name: "Do", type: "agentic" },
          { id: "check", name: "Check", type: "deterministic", gate: { checks: [{ type: "test", language: "typescript" }], onFail: "retry" } },
          { id: "fix", name: "Fix", type: "agentic", maxIterations: 2, retryFromNodeId: "check" },
        ],
      };
      expect(validateBlueprint(bp as any)).toBeNull();
    });
  });
});
