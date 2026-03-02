import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";

describe("GET /health", () => {
  it("returns status ok with uptime", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptime).toBe("number");
  });
});
