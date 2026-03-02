import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import { PtyManager } from "../src/pty-manager.js";
import WebSocket from "ws";
import http from "node:http";

describe("PtyManager class", () => {
  const manager = new PtyManager();

  afterEach(() => {
    manager.destroyAll();
  });

  it("starts a session and captures output", async () => {
    const session = manager.start("echo-test", "echo", [
      "hello from pty",
    ]);
    expect(session.id).toBe("echo-test");

    const output: string[] = [];
    session.onData((data) => output.push(data));

    const exitCode = await session.waitForExit();
    expect(exitCode).toBe(0);
    expect(output.join("")).toContain("hello from pty");
  });

  it("writes data to stdin", async () => {
    const session = manager.start("cat-test", "cat", []);

    const output: string[] = [];
    session.onData((data) => output.push(data));

    session.write("typed input\n");

    // Wait a bit for the echo
    await new Promise((r) => setTimeout(r, 300));

    session.kill();
    await session.waitForExit();

    expect(output.join("")).toContain("typed input");
  });

  it("kills a session", async () => {
    const session = manager.start("sleep-test", "sleep", ["60"]);
    session.kill();
    const exitCode = await session.waitForExit();
    // Process was killed — it should have exited (exit code varies by platform)
    expect(typeof exitCode).toBe("number");
  });

  it("resizes a session", () => {
    const session = manager.start("resize-test", "bash", []);
    // Should not throw
    session.resize(120, 40);
    session.kill();
  });

  it("tracks sessions by ID", () => {
    manager.start("tracked", "echo", ["test"]);
    expect(manager.get("tracked")).toBeDefined();
    expect(manager.get("nonexistent")).toBeUndefined();
  });
});

describe("PTY HTTP routes", () => {
  const app = createApp();

  it("POST /pty/start creates a session", async () => {
    const res = await request(app)
      .post("/pty/start")
      .send({ id: "http-test", cmd: "echo", args: ["hello"] });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("http-test");

    // Cleanup
    await request(app).post("/pty/kill").send({ id: "http-test" });
  });

  it("POST /pty/write sends data to session", async () => {
    await request(app)
      .post("/pty/start")
      .send({ id: "write-test", cmd: "cat" });

    const res = await request(app)
      .post("/pty/write")
      .send({ id: "write-test", data: "hello\n" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await request(app).post("/pty/kill").send({ id: "write-test" });
  });

  it("POST /pty/resize resizes session", async () => {
    await request(app)
      .post("/pty/start")
      .send({ id: "resize-http-test", cmd: "bash" });

    const res = await request(app)
      .post("/pty/resize")
      .send({ id: "resize-http-test", cols: 120, rows: 40 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await request(app).post("/pty/kill").send({ id: "resize-http-test" });
  });

  it("POST /pty/kill terminates session", async () => {
    await request(app)
      .post("/pty/start")
      .send({ id: "kill-test", cmd: "sleep", args: ["60"] });

    const res = await request(app)
      .post("/pty/kill")
      .send({ id: "kill-test" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 404 for nonexistent session", async () => {
    const res = await request(app)
      .post("/pty/write")
      .send({ id: "nope", data: "hello" });
    expect(res.status).toBe(404);
  });
});

describe("PTY WebSocket streaming", () => {
  let server: http.Server;
  let port: number;

  it("streams PTY output over WebSocket", async () => {
    const app = createApp();
    server = http.createServer(app);

    const { attachWebSocket } = await import("../src/routes/pty.js");
    attachWebSocket(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    port = (server.address() as any).port;

    // Start a bash session (stays alive until we exit it)
    await request(app)
      .post("/pty/start")
      .send({ id: "ws-test", cmd: "bash" });

    // Connect WebSocket
    const ws = new WebSocket(`ws://localhost:${port}/pty/stream?id=ws-test`);
    const messages: any[] = [];

    await new Promise<void>((resolve) => {
      ws.on("open", () => {
        // Once connected, send a command through the PTY
        setTimeout(async () => {
          await request(app)
            .post("/pty/write")
            .send({ id: "ws-test", data: "echo ws-hello-marker\nexit\n" });
        }, 100);
      });

      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 5000);

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        messages.push(msg);
        if (msg.type === "exit") {
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      });
    });

    const dataMessages = messages.filter((m) => m.type === "data");
    const exitMessages = messages.filter((m) => m.type === "exit");

    expect(dataMessages.length).toBeGreaterThan(0);
    expect(dataMessages[0]).toHaveProperty("timestamp");
    const allData = dataMessages.map((m) => m.data).join("");
    expect(allData).toContain("ws-hello-marker");
    expect(exitMessages.length).toBe(1);
    expect(typeof exitMessages[0].exitCode).toBe("number");

    server.close();
  });
});
