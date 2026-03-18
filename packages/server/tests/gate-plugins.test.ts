// packages/server/tests/gate-plugins.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { existsSync } from "node:fs";
import { typescriptPlugin } from "../src/cycles/plugins/typescript.js";

describe("TypeScript Gate Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detect", () => {
    it("returns true when tsconfig.json exists", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const result = await typescriptPlugin.detect("/workspace");
      expect(result).toBe(true);
      expect(existsSync).toHaveBeenCalledWith("/workspace/tsconfig.json");
    });

    it("returns false when tsconfig.json is missing", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const result = await typescriptPlugin.detect("/workspace");
      expect(result).toBe(false);
    });
  });

  describe("typecheck parseOutput", () => {
    const parse = typescriptPlugin.checks.typecheck!.parseOutput;

    it("reports success when exit code is 0", () => {
      const result = parse("", "", 0);
      expect(result.passed).toBe(true);
      expect(result.errorCount).toBe(0);
    });

    it("counts errors from stderr", () => {
      const stderr = [
        "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/api.ts(12,7): error TS2345: Argument of type 'null' is not assignable.",
      ].join("\n");
      const result = parse("", stderr, 2);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(2);
      expect(result.summary).toBe("2 type errors");
      expect(result.details).toBe(stderr);
    });

    it("handles single error grammar", () => {
      const stderr = "src/index.ts(1,1): error TS2322: Type mismatch.";
      const result = parse("", stderr, 2);
      expect(result.errorCount).toBe(1);
      expect(result.summary).toBe("1 type error");
    });
  });

  describe("lint parseOutput", () => {
    const parse = typescriptPlugin.checks.lint!.parseOutput;

    it("reports success when exit code is 0", () => {
      const result = parse("", "", 0);
      expect(result.passed).toBe(true);
    });

    it("counts problems from eslint output", () => {
      const stdout = "\n✖ 5 problems (3 errors, 2 warnings)\n";
      const result = parse(stdout, "", 1);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(3);
      expect(result.warningCount).toBe(2);
      expect(result.summary).toBe("3 errors, 2 warnings");
    });
  });

  describe("test parseOutput", () => {
    const parse = typescriptPlugin.checks.test!.parseOutput;

    it("reports success when exit code is 0", () => {
      const stdout = " Tests  12 passed (12)\n";
      const result = parse(stdout, "", 0);
      expect(result.passed).toBe(true);
      expect(result.summary).toContain("12 passed");
    });

    it("reports failures", () => {
      const stdout = " Tests  3 failed | 9 passed (12)\n";
      const result = parse(stdout, "", 1);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(3);
      expect(result.summary).toContain("3 failed");
    });
  });

  describe("build parseOutput", () => {
    const parse = typescriptPlugin.checks.build!.parseOutput;

    it("reports success when exit code is 0", () => {
      const result = parse("", "", 0);
      expect(result.passed).toBe(true);
      expect(result.summary).toBe("Build succeeded");
    });

    it("reports failure with error count", () => {
      const stderr = "src/a.ts(1,1): error TS1234: Something.\nsrc/b.ts(2,2): error TS5678: Other.";
      const result = parse("", stderr, 1);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(2);
    });
  });
});
