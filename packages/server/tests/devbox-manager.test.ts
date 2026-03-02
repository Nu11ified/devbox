import { describe, it, expect, afterAll } from "vitest";
import { DevboxManager } from "../src/devbox/manager.js";

const manager = new DevboxManager();

// Track containers to clean up
const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds) {
    try {
      await manager.destroy(id);
    } catch {
      // ignore cleanup errors
    }
  }
}, 60000);

describe("DevboxManager", () => {
  describe("create()", () => {
    it("creates and starts a container, returns info", async () => {
      const info = await manager.create({
        image: "alpine:latest",
        name: `patchwork-test-${Date.now()}`,
        env: { TEST_VAR: "hello" },
        cpus: 1,
        memoryMB: 256,
      });

      createdIds.push(info.containerId);

      expect(info.containerId).toBeDefined();
      expect(info.containerId.length).toBeGreaterThan(10);
      expect(info.status).toBe("running");
    });
  });

  describe("running commands inside containers", () => {
    it("runs a command and captures output", async () => {
      const info = await manager.create({
        image: "alpine:latest",
        name: `patchwork-test-run-${Date.now()}`,
      });
      createdIds.push(info.containerId);

      const result = await manager.runInContainer(info.containerId, [
        "echo",
        "hello world",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("hello world");
      expect(result.stderr).toBe("");
    });

    it("captures stderr and non-zero exit code", async () => {
      const info = await manager.create({
        image: "alpine:latest",
        name: `patchwork-test-run-fail-${Date.now()}`,
      });
      createdIds.push(info.containerId);

      const result = await manager.runInContainer(info.containerId, [
        "sh",
        "-c",
        "echo err >&2 && exit 42",
      ]);

      expect(result.exitCode).toBe(42);
      expect(result.stderr.trim()).toBe("err");
    });

    it("reads env vars injected at creation", async () => {
      const info = await manager.create({
        image: "alpine:latest",
        name: `patchwork-test-run-env-${Date.now()}`,
        env: { MY_VAR: "test-value" },
      });
      createdIds.push(info.containerId);

      const result = await manager.runInContainer(info.containerId, [
        "sh",
        "-c",
        "echo $MY_VAR",
      ]);
      expect(result.stdout.trim()).toBe("test-value");
    });
  });

  describe("list()", () => {
    it("lists only patchwork containers", async () => {
      const info = await manager.create({
        image: "alpine:latest",
        name: `patchwork-test-list-${Date.now()}`,
      });
      createdIds.push(info.containerId);

      const containers = await manager.list();
      expect(containers.length).toBeGreaterThanOrEqual(1);

      const found = containers.find(
        (c) => c.containerId === info.containerId
      );
      expect(found).toBeDefined();
      expect(found!.status).toBe("running");
    });
  });

  describe("destroy()", () => {
    it("stops and removes a container", { timeout: 15000 }, async () => {
      const info = await manager.create({
        image: "alpine:latest",
        name: `patchwork-test-destroy-${Date.now()}`,
      });

      await manager.destroy(info.containerId);

      // Remove from tracking since it's already destroyed
      const idx = createdIds.indexOf(info.containerId);
      if (idx >= 0) createdIds.splice(idx, 1);

      const containers = await manager.list();
      const found = containers.find(
        (c) => c.containerId === info.containerId
      );
      expect(found).toBeUndefined();
    });
  });
});
