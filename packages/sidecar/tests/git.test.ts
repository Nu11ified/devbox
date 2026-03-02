import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

let app: ReturnType<typeof createApp>;
let repoDir: string;

function git(...args: string[]) {
  return execFileSync("git", args, { cwd: repoDir, encoding: "utf-8" });
}

beforeAll(async () => {
  app = createApp();
  repoDir = await mkdtemp(join(tmpdir(), "sidecar-git-test-"));

  // Initialize a git repo with an initial commit
  git("init");
  git("config", "user.email", "test@test.com");
  git("config", "user.name", "Test");
  await writeFile(join(repoDir, "README.md"), "# Test\n");
  git("add", ".");
  git("commit", "-m", "Initial commit");
});

afterAll(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe("GET /git/status", () => {
  it("returns empty files array for clean repo", async () => {
    const res = await request(app)
      .get("/git/status")
      .query({ cwd: repoDir });
    expect(res.status).toBe(200);
    expect(res.body.files).toEqual([]);
  });

  it("detects modified files", async () => {
    await writeFile(join(repoDir, "README.md"), "# Modified\n");
    const res = await request(app)
      .get("/git/status")
      .query({ cwd: repoDir });
    expect(res.status).toBe(200);
    expect(res.body.files.length).toBeGreaterThan(0);
    expect(res.body.files[0].path).toBe("README.md");
    // Restore
    git("checkout", "--", "README.md");
  });

  it("detects new untracked files", async () => {
    await writeFile(join(repoDir, "new-file.txt"), "new content\n");
    const res = await request(app)
      .get("/git/status")
      .query({ cwd: repoDir });
    expect(res.status).toBe(200);
    const newFile = res.body.files.find(
      (f: { path: string }) => f.path === "new-file.txt"
    );
    expect(newFile).toBeDefined();
    expect(newFile.status).toBe("?");
    // Cleanup
    git("checkout", "--", ".");
    await rm(join(repoDir, "new-file.txt"), { force: true });
  });
});

describe("GET /git/diff", () => {
  it("returns empty diff for clean repo", async () => {
    const res = await request(app)
      .get("/git/diff")
      .query({ cwd: repoDir });
    expect(res.status).toBe(200);
    expect(res.body.diff).toBe("");
  });

  it("returns unified diff for modified files", async () => {
    await writeFile(join(repoDir, "README.md"), "# Changed\n");
    const res = await request(app)
      .get("/git/diff")
      .query({ cwd: repoDir });
    expect(res.status).toBe(200);
    expect(res.body.diff).toContain("--- a/README.md");
    expect(res.body.diff).toContain("+++ b/README.md");
    // Restore
    git("checkout", "--", "README.md");
  });
});

describe("POST /git/commit", () => {
  it("stages and commits, returning SHA", async () => {
    await writeFile(join(repoDir, "committed.txt"), "committed\n");
    const res = await request(app)
      .post("/git/commit")
      .send({ cwd: repoDir, message: "Add committed.txt" });
    expect(res.status).toBe(200);
    expect(res.body.sha).toMatch(/^[0-9a-f]{40}$/);

    // Verify the file is committed
    const log = git("log", "--oneline", "-1");
    expect(log).toContain("Add committed.txt");
  });
});

describe("POST /git/apply", () => {
  it("applies a patch", async () => {
    // Create a patch
    const patch = `--- a/patched.txt
+++ b/patched.txt
@@ -0,0 +1 @@
+patched content
`;
    // First create the file so we can apply a patch
    await writeFile(join(repoDir, "patched.txt"), "");
    git("add", "patched.txt");
    git("commit", "-m", "Add empty patched.txt");

    const res = await request(app)
      .post("/git/apply")
      .send({ cwd: repoDir, patch });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const content = await readFile(join(repoDir, "patched.txt"), "utf-8");
    expect(content.trim()).toBe("patched content");
  });
});

describe("POST /git/push", () => {
  it("returns error when no remote configured", async () => {
    const res = await request(app)
      .post("/git/push")
      .send({ cwd: repoDir });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });
});
