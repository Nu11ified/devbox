import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";

describe("POST /exec", () => {
  const app = createApp();

  it("executes a simple command and returns output", async () => {
    const res = await request(app)
      .post("/exec")
      .send({ cmd: "echo", args: ["hello world"] });
    expect(res.status).toBe(200);
    expect(res.body.exitCode).toBe(0);
    expect(res.body.stdout.trim()).toBe("hello world");
    expect(res.body.stderr).toBe("");
  });

  it("returns non-zero exit code on failure", async () => {
    const res = await request(app)
      .post("/exec")
      .send({ cmd: "false" });
    expect(res.status).toBe(200);
    expect(res.body.exitCode).not.toBe(0);
  });

  it("returns 400 when cmd is missing", async () => {
    const res = await request(app)
      .post("/exec")
      .send({ args: ["hello"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("respects timeout and kills long-running commands", async () => {
    const res = await request(app)
      .post("/exec")
      .send({ cmd: "sleep", args: ["30"], timeout: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.exitCode).not.toBe(0);
    expect(res.body.stderr).toMatch(/timed out|killed|SIGTERM/i);
  });

  it("uses cwd parameter", async () => {
    const res = await request(app)
      .post("/exec")
      .send({ cmd: "pwd", cwd: "/tmp" });
    expect(res.status).toBe(200);
    expect(res.body.stdout.trim()).toBe("/tmp");
  });
});
