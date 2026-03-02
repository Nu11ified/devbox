import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SidecarClient } from "../src/agents/backend.js";
import { CIManager } from "../src/ci/manager.js";
import type { CIResult, CIFailure } from "../src/ci/manager.js";

function createMockSidecar(overrides: Partial<SidecarClient> = {}): SidecarClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue(""),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("CIManager", () => {
  let sidecar: SidecarClient;
  let ci: CIManager;

  beforeEach(() => {
    sidecar = createMockSidecar();
    ci = new CIManager(sidecar);
  });

  describe("pushBranch", () => {
    it("pushes branch via sidecar git push", async () => {
      (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 0,
        stdout: "Everything up-to-date",
        stderr: "",
      });

      const result = await ci.pushBranch("feature/foo");

      expect(sidecar.exec).toHaveBeenCalledWith("git", ["push", "origin", "feature/foo"]);
      expect(result.success).toBe(true);
    });

    it("returns failure when push fails", async () => {
      (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "rejected",
      });

      const result = await ci.pushBranch("feature/foo");
      expect(result.success).toBe(false);
    });
  });

  describe("pollCI", () => {
    it("returns success when CI passes", async () => {
      const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
      // First call: gh run list returns completed/success
      execMock.mockResolvedValueOnce({
        exitCode: 0,
        stdout: "12345\tcompleted\tsuccess\thttps://github.com/test/repo/actions/runs/12345",
        stderr: "",
      });

      const result = await ci.pollCI("test/repo", "abc123", 5000);

      expect(result.status).toBe("success");
      expect(result.url).toBe("https://github.com/test/repo/actions/runs/12345");
    });

    it("returns failure when CI fails", async () => {
      const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
      // gh run list returns completed/failure
      execMock
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "12345\tcompleted\tfailure\thttps://github.com/test/repo/actions/runs/12345",
          stderr: "",
        })
        // gh run view --log for failure logs
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "FAIL src/test.ts\n  Error: expected 1 to be 2",
          stderr: "",
        });

      const result = await ci.pollCI("test/repo", "abc123", 5000);

      expect(result.status).toBe("failure");
      expect(result.logs).toContain("FAIL");
    });

    it("returns timeout when polling exceeds limit", async () => {
      const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
      // Always return in_progress
      execMock.mockResolvedValue({
        exitCode: 0,
        stdout: "12345\tin_progress\t\thttps://github.com/test/repo/actions/runs/12345",
        stderr: "",
      });

      const result = await ci.pollCI("test/repo", "abc123", 100);
      expect(result.status).toBe("timeout");
    });
  });

  describe("parseFailures", () => {
    it("extracts test failures from logs", () => {
      const logs = [
        "FAIL src/utils.test.ts",
        "  ● add function › should add two numbers",
        "    expect(received).toBe(expected)",
        "    Expected: 3",
        "    Received: 2",
        "",
        "    at Object.<anonymous> (src/utils.test.ts:5:22)",
      ].join("\n");

      const failures = ci.parseFailures(logs);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].type).toBe("test");
      expect(failures[0].file).toBe("src/utils.test.ts");
    });

    it("extracts build errors from logs", () => {
      const logs = [
        "src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      ].join("\n");

      const failures = ci.parseFailures(logs);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].type).toBe("build");
      expect(failures[0].file).toBe("src/index.ts");
      expect(failures[0].line).toBe(10);
    });

    it("extracts lint errors from logs", () => {
      const logs = [
        "src/app.ts",
        "  3:10  error  'foo' is defined but never used  @typescript-eslint/no-unused-vars",
      ].join("\n");

      const failures = ci.parseFailures(logs);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures[0].type).toBe("lint");
    });

    it("returns empty array for clean logs", () => {
      const logs = "All tests passed.\nBuild succeeded.";
      const failures = ci.parseFailures(logs);
      expect(failures).toEqual([]);
    });
  });
});
