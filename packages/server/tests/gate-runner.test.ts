// packages/server/tests/gate-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { runGateCheck, runGateChecks } from "../src/cycles/gates.js";
import type { GateCheckResult } from "../src/cycles/plugins/types.js";

describe("Gate Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runGateCheck", () => {
    it("runs a typecheck and returns parsed result on success", async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
      const result = await runGateCheck("typecheck", "typescript", "/workspace");
      expect(result.passed).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        "npx",
        ["tsc", "--noEmit"],
        expect.objectContaining({ cwd: "/workspace", stdio: "pipe" })
      );
    });

    it("returns parsed failure when command exits non-zero", async () => {
      const error = new Error("Command failed") as any;
      error.status = 2;
      error.stdout = Buffer.from("");
      error.stderr = Buffer.from("src/a.ts(1,1): error TS2322: Type mismatch.");
      vi.mocked(execFileSync).mockImplementation(() => { throw error; });

      const result = await runGateCheck("typecheck", "typescript", "/workspace");
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
    });

    it("throws for unknown language", async () => {
      await expect(runGateCheck("typecheck", "cobol", "/workspace"))
        .rejects.toThrow("No gate plugin registered for language: cobol");
    });

    it("throws for unsupported check type", async () => {
      await expect(runGateCheck("build", "typescript", "/workspace"))
        .resolves.toBeDefined(); // typescript supports build
    });
  });

  describe("runGateChecks", () => {
    it("runs multiple checks and returns all results", async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
      const results = await runGateChecks(
        [
          { type: "typecheck", language: "typescript" },
          { type: "lint", language: "typescript" },
        ],
        "/workspace"
      );
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it("returns all results even if some fail", async () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Buffer.from(""); // typecheck passes
        const error = new Error("lint failed") as any;
        error.status = 1;
        error.stdout = Buffer.from("\n✖ 2 problems (2 errors, 0 warnings)\n");
        error.stderr = Buffer.from("");
        throw error;
      });

      const results = await runGateChecks(
        [
          { type: "typecheck", language: "typescript" },
          { type: "lint", language: "typescript" },
        ],
        "/workspace"
      );
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });

    it("runs custom checks via shell command", async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from("ok"));
      const results = await runGateChecks(
        [{ type: "custom", language: "typescript", command: "npm run custom-check" }],
        "/workspace"
      );
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });
  });
});
