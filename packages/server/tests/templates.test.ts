import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import pg from "pg";
import { createApp } from "../src/index.js";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://patchwork:patchwork@localhost:5433/patchwork";

describe("Devbox Templates CRUD", () => {
  let app: ReturnType<typeof createApp>["app"];
  let client: pg.Client;

  const validTemplate = {
    name: "node-20-test",
    baseImage: "patchwork/devbox-node:20",
    resourceLimits: { cpus: 2, memoryMB: 4096, diskMB: 10240 },
  };

  beforeAll(async () => {
    // Run migration
    const { runMigration } = await import("../src/db/migrate.js");
    await runMigration(DATABASE_URL);

    ({ app } = createApp());
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();

    // Clean up test data
    await client.query("DELETE FROM devbox_templates WHERE name LIKE 'node-20-test%'");
  });

  afterAll(async () => {
    await client.query("DELETE FROM devbox_templates WHERE name LIKE 'node-20-test%'");
    await client.end();
  });

  describe("POST /api/templates", () => {
    it("creates a template with valid data", async () => {
      const res = await request(app)
        .post("/api/templates")
        .send(validTemplate);

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe(validTemplate.name);
      expect(res.body.baseImage).toBe(validTemplate.baseImage);
      expect(res.body.resourceLimits).toEqual(validTemplate.resourceLimits);
    });

    it("rejects when name is missing", async () => {
      const res = await request(app)
        .post("/api/templates")
        .send({ baseImage: "img", resourceLimits: { cpus: 1, memoryMB: 512, diskMB: 1024 } });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it("rejects when baseImage is missing", async () => {
      const res = await request(app)
        .post("/api/templates")
        .send({ name: "node-20-test-no-img", resourceLimits: { cpus: 1, memoryMB: 512, diskMB: 1024 } });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/baseImage/i);
    });

    it("rejects when resourceLimits is missing", async () => {
      const res = await request(app)
        .post("/api/templates")
        .send({ name: "node-20-test-no-limits", baseImage: "img" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/resourceLimits/i);
    });

    it("rejects duplicate names", async () => {
      const res = await request(app)
        .post("/api/templates")
        .send(validTemplate);

      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/templates", () => {
    it("lists templates", async () => {
      const res = await request(app).get("/api/templates");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /api/templates/:id", () => {
    it("gets a template by ID", async () => {
      // First create one
      const created = await request(app)
        .post("/api/templates")
        .send({ ...validTemplate, name: "node-20-test-get" });

      const res = await request(app).get(`/api/templates/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("node-20-test-get");
    });

    it("returns 404 for non-existent ID", async () => {
      const res = await request(app).get(
        "/api/templates/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/templates/:id", () => {
    it("updates a template", async () => {
      const created = await request(app)
        .post("/api/templates")
        .send({ ...validTemplate, name: "node-20-test-update" });

      const res = await request(app)
        .put(`/api/templates/${created.body.id}`)
        .send({ name: "node-20-test-updated", baseImage: "patchwork/devbox-node:22" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("node-20-test-updated");
      expect(res.body.baseImage).toBe("patchwork/devbox-node:22");
    });

    it("returns 404 for non-existent ID", async () => {
      const res = await request(app)
        .put("/api/templates/00000000-0000-0000-0000-000000000000")
        .send({ name: "nope" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/templates/:id", () => {
    it("deletes a template", async () => {
      const created = await request(app)
        .post("/api/templates")
        .send({ ...validTemplate, name: "node-20-test-delete" });

      const res = await request(app).delete(`/api/templates/${created.body.id}`);
      expect(res.status).toBe(204);

      const check = await request(app).get(`/api/templates/${created.body.id}`);
      expect(check.status).toBe(404);
    });

    it("returns 404 for non-existent ID", async () => {
      const res = await request(app).delete(
        "/api/templates/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
    });
  });
});
