import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    userSettings: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "../src/db/prisma.js";
import { settingsRouter } from "../src/api/settings.js";

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  return app;
}

describe("Settings API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp("user-1");
  });

  // ── GET /api/settings ─────────────────────────────────────────────────

  describe("GET /api/settings", () => {
    it("returns settings with masked API key", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({
        id: "s-1",
        userId: "user-1",
        anthropicApiKey: "sk-ant-api03-abcdef1234567890",
        sshHost: "devbox.example.com",
        defaultProvider: "claude-code",
      } as any);

      const res = await request(app).get("/api/settings");

      expect(res.status).toBe(200);
      expect(res.body.anthropicApiKey).toBe("****7890");
      expect(res.body.sshHost).toBe("devbox.example.com");
    });

    it("returns null API key when none is set", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({
        id: "s-1",
        userId: "user-1",
        anthropicApiKey: null,
        sshHost: null,
      } as any);

      const res = await request(app).get("/api/settings");

      expect(res.status).toBe(200);
      expect(res.body.anthropicApiKey).toBeNull();
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get("/api/settings");
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/authentication/i);
    });
  });

  // ── PUT /api/settings ─────────────────────────────────────────────────

  describe("PUT /api/settings", () => {
    it("updates sshHost setting", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({
        id: "s-1",
        userId: "user-1",
        sshHost: "new-host.example.com",
      } as any);

      const res = await request(app)
        .put("/api/settings")
        .send({ sshHost: "new-host.example.com" });

      expect(res.status).toBe(200);
      expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ sshHost: "new-host.example.com" }),
        })
      );
    });

    it("updates multiple settings at once", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({
        id: "s-1",
        userId: "user-1",
        defaultProvider: "claude-code",
        defaultModel: "claude-opus-4-6",
        sshHost: "dev.local",
      } as any);

      const res = await request(app)
        .put("/api/settings")
        .send({
          defaultProvider: "claude-code",
          defaultModel: "claude-opus-4-6",
          sshHost: "dev.local",
        });

      expect(res.status).toBe(200);
      expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            defaultProvider: "claude-code",
            defaultModel: "claude-opus-4-6",
            sshHost: "dev.local",
          }),
        })
      );
    });

    it("updates anthropicApiKey setting", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({} as any);

      const res = await request(app)
        .put("/api/settings")
        .send({ anthropicApiKey: "sk-new-key-123" });

      expect(res.status).toBe(200);
      expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ anthropicApiKey: "sk-new-key-123" }),
        })
      );
    });

    it("ignores unknown fields in update data", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({} as any);

      const res = await request(app)
        .put("/api/settings")
        .send({ sshHost: "host.local", unknownField: "should-be-ignored" });

      expect(res.status).toBe(200);
      const callArg = vi.mocked(prisma.userSettings.upsert).mock.calls[0][0];
      expect(callArg.update).not.toHaveProperty("unknownField");
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).put("/api/settings").send({ sshHost: "x" });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/settings/onboarding ──────────────────────────────────────

  describe("GET /api/settings/onboarding", () => {
    it("returns completed: true when onboarding is done", async () => {
      vi.mocked(prisma.userSettings.findUnique).mockResolvedValueOnce({
        userId: "user-1",
        onboardingCompleted: true,
      } as any);

      const res = await request(app).get("/api/settings/onboarding");

      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(true);
    });

    it("returns completed: false when no settings exist", async () => {
      vi.mocked(prisma.userSettings.findUnique).mockResolvedValueOnce(null);

      const res = await request(app).get("/api/settings/onboarding");

      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(false);
    });

    it("returns completed: false when onboarding not completed", async () => {
      vi.mocked(prisma.userSettings.findUnique).mockResolvedValueOnce({
        userId: "user-1",
        onboardingCompleted: false,
      } as any);

      const res = await request(app).get("/api/settings/onboarding");

      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(false);
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get("/api/settings/onboarding");
      expect(res.status).toBe(401);
    });
  });
});
