import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://patchwork:patchwork@localhost:5433/patchwork";

describe("Server setup", () => {
  describe("GET /api/health", () => {
    it("returns status ok with version", async () => {
      const app = createApp();
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.version).toBe("0.1.0");
    });
  });

  describe("Database connection", () => {
    it("connects to PostgreSQL", async () => {
      const client = new pg.Client({ connectionString: DATABASE_URL });
      await client.connect();
      const result = await client.query("SELECT 1 AS num");
      expect(result.rows[0].num).toBe(1);
      await client.end();
    });
  });

  describe("Schema migration", () => {
    let client: pg.Client;

    afterAll(async () => {
      if (client) await client.end();
    });

    it("creates all required tables after migration", async () => {
      // Run migration first
      const { runMigration } = await import("../src/db/migrate.js");
      await runMigration(DATABASE_URL);

      client = new pg.Client({ connectionString: DATABASE_URL });
      await client.connect();

      const tables = [
        "devbox_templates",
        "runs",
        "devboxes",
        "run_steps",
        "patches",
        "transcript_events",
        "artifacts",
        "issues",
      ];

      for (const table of tables) {
        const result = await client.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          )`,
          [table]
        );
        expect(result.rows[0].exists, `Table ${table} should exist`).toBe(
          true
        );
      }
    });

    it("creates required indexes", async () => {
      if (!client) {
        client = new pg.Client({ connectionString: DATABASE_URL });
        await client.connect();
      }

      const indexes = [
        "idx_runs_status",
        "idx_runs_created_by",
        "idx_run_steps_run_id",
        "idx_patches_run_id",
        "idx_transcript_run_id",
        "idx_transcript_created",
        "idx_artifacts_run_id",
        "idx_issues_status",
        "idx_issues_priority",
      ];

      for (const idx of indexes) {
        const result = await client.query(
          `SELECT EXISTS (
            SELECT FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = $1
          )`,
          [idx]
        );
        expect(result.rows[0].exists, `Index ${idx} should exist`).toBe(true);
      }
    });
  });
});
