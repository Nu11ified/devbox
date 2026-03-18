import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    ankiCard: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import prisma from "../src/db/prisma.js";
import { ankiRouter } from "../src/api/anki.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/projects/:projectId/anki", ankiRouter());
  return app;
}

const PROJECT_ID = "proj-1";
const CARD_ID = "card-1";
const USER_ID = "user-1";

const mockProject = { id: PROJECT_ID, name: "Test Project", userId: USER_ID };

const mockCard = {
  id: CARD_ID,
  projectId: PROJECT_ID,
  group: "react",
  title: "useEffect cleanup",
  contents: "Always return a cleanup function from useEffect.",
  referencedFiles: [],
  stale: false,
  staleReason: null,
  accessCount: 0,
  lastVerifiedAt: null,
  createdByThreadId: null,
  updatedByThreadId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("Anki API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp(USER_ID);
  });

  // ── GET /api/projects/:projectId/anki ─────────────────────────────

  describe("GET /api/projects/:projectId/anki", () => {
    it("returns 401 when no user", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get(`/api/projects/${PROJECT_ID}/anki`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when project not found", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/anki`);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns list of cards for valid project", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValueOnce([mockCard] as any);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/anki`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(CARD_ID);
      expect(prisma.ankiCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: PROJECT_ID }),
        })
      );
    });

    it("filters by ?group= query param", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValueOnce([mockCard] as any);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/anki?group=react`);

      expect(res.status).toBe(200);
      expect(prisma.ankiCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: PROJECT_ID, group: "react" }),
        })
      );
    });

    it("filters by ?stale=true query param", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValueOnce([] as any);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/anki?stale=true`);

      expect(res.status).toBe(200);
      expect(prisma.ankiCard.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: PROJECT_ID, stale: true }),
        })
      );
    });
  });

  // ── GET /api/projects/:projectId/anki/:cardId ─────────────────────

  describe("GET /api/projects/:projectId/anki/:cardId", () => {
    it("returns 401 when no user", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when card not found", async () => {
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns card for valid request", async () => {
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(mockCard as any);

      const res = await request(app).get(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(CARD_ID);
      expect(res.body.group).toBe("react");
      expect(prisma.ankiCard.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: CARD_ID,
            project: { id: PROJECT_ID, userId: USER_ID },
          }),
        })
      );
    });
  });

  // ── POST /api/projects/:projectId/anki ────────────────────────────

  describe("POST /api/projects/:projectId/anki", () => {
    const validBody = {
      group: "react",
      title: "useEffect cleanup",
      contents: "Always return a cleanup function.",
    };

    it("returns 401 when no user", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send(validBody);
      expect(res.status).toBe(401);
    });

    it("returns 404 when project not found", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send(validBody);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 400 when group is missing", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send({ title: "some title", contents: "some contents" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/group/i);
    });

    it("returns 400 when title is missing", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send({ group: "react", contents: "some contents" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it("returns 400 when contents is missing", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send({ group: "react", title: "some title" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/contents/i);
    });

    it("returns 400 when group has invalid characters", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send({ ...validBody, group: "Bad Group!" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/group/i);
    });

    it("returns 400 when group exceeds max length", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send({ ...validBody, group: "a".repeat(51) });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/group/i);
    });

    it("returns 201 with created card on success", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);
      vi.mocked(prisma.ankiCard.create).mockResolvedValueOnce(mockCard as any);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send(validBody);

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(CARD_ID);
      expect(prisma.ankiCard.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: PROJECT_ID,
            group: "react",
            title: "useEffect cleanup",
            contents: "Always return a cleanup function.",
          }),
        })
      );
    });

    it("returns 409 on duplicate group+title (P2002 error)", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);
      const p2002Error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      vi.mocked(prisma.ankiCard.create).mockRejectedValueOnce(p2002Error);

      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/anki`)
        .send(validBody);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/i);
    });
  });

  // ── PUT /api/projects/:projectId/anki/:cardId ─────────────────────

  describe("PUT /api/projects/:projectId/anki/:cardId", () => {
    it("returns 401 when no user", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser)
        .put(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`)
        .send({ title: "Updated title" });
      expect(res.status).toBe(401);
    });

    it("returns 404 when card not found", async () => {
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(null);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`)
        .send({ title: "Updated title" });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 400 on invalid input", async () => {
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(mockCard as any);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`)
        .send({ group: "Invalid Group!" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/group/i);
    });

    it("updates card and returns 200", async () => {
      const updatedCard = { ...mockCard, title: "Updated title" };
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(mockCard as any);
      vi.mocked(prisma.ankiCard.update).mockResolvedValueOnce(updatedCard as any);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`)
        .send({ title: "Updated title" });

      expect(res.status).toBe(200);
      expect(res.body.title).toBe("Updated title");
      expect(prisma.ankiCard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CARD_ID },
          data: expect.objectContaining({ title: "Updated title" }),
        })
      );
    });

    it("resets stale and sets lastVerifiedAt when contents updated", async () => {
      const updatedCard = { ...mockCard, contents: "New contents", stale: false };
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(mockCard as any);
      vi.mocked(prisma.ankiCard.update).mockResolvedValueOnce(updatedCard as any);

      const res = await request(app)
        .put(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`)
        .send({ contents: "New contents" });

      expect(res.status).toBe(200);
      expect(prisma.ankiCard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CARD_ID },
          data: expect.objectContaining({
            contents: "New contents",
            stale: false,
            lastVerifiedAt: expect.any(Date),
          }),
        })
      );
    });
  });

  // ── DELETE /api/projects/:projectId/anki/:cardId ──────────────────

  describe("DELETE /api/projects/:projectId/anki/:cardId", () => {
    it("returns 401 when no user", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).delete(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when card not found", async () => {
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).delete(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 204 on successful delete", async () => {
      vi.mocked(prisma.ankiCard.findFirst).mockResolvedValueOnce(mockCard as any);
      vi.mocked(prisma.ankiCard.delete).mockResolvedValueOnce(mockCard as any);

      const res = await request(app).delete(`/api/projects/${PROJECT_ID}/anki/${CARD_ID}`);

      expect(res.status).toBe(204);
      expect(prisma.ankiCard.delete).toHaveBeenCalledWith({
        where: { id: CARD_ID },
      });
    });
  });
});
