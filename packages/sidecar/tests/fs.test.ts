import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let app: ReturnType<typeof createApp>;
let tempDir: string;

beforeAll(async () => {
  app = createApp();
  tempDir = await mkdtemp(join(tmpdir(), "sidecar-fs-test-"));
  await writeFile(join(tempDir, "existing.txt"), "hello world\n");
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("GET /fs/read", () => {
  it("reads an existing file", async () => {
    const res = await request(app)
      .get("/fs/read")
      .query({ path: join(tempDir, "existing.txt") });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("hello world\n");
  });

  it("returns 404 for missing file", async () => {
    const res = await request(app)
      .get("/fs/read")
      .query({ path: join(tempDir, "nope.txt") });
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when path is missing", async () => {
    const res = await request(app).get("/fs/read");
    expect(res.status).toBe(400);
  });
});

describe("POST /fs/write", () => {
  it("writes a new file", async () => {
    const filePath = join(tempDir, "written.txt");
    const res = await request(app)
      .post("/fs/write")
      .send({ path: filePath, content: "written content\n" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify by reading it back
    const readRes = await request(app)
      .get("/fs/read")
      .query({ path: filePath });
    expect(readRes.body.content).toBe("written content\n");
  });

  it("overwrites an existing file", async () => {
    const filePath = join(tempDir, "existing.txt");
    const res = await request(app)
      .post("/fs/write")
      .send({ path: filePath, content: "overwritten\n" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const readRes = await request(app)
      .get("/fs/read")
      .query({ path: filePath });
    expect(readRes.body.content).toBe("overwritten\n");
  });

  it("creates intermediate directories", async () => {
    const filePath = join(tempDir, "sub", "dir", "deep.txt");
    const res = await request(app)
      .post("/fs/write")
      .send({ path: filePath, content: "deep\n" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 when path or content is missing", async () => {
    const res = await request(app)
      .post("/fs/write")
      .send({ path: join(tempDir, "x.txt") });
    expect(res.status).toBe(400);
  });
});
