import { describe, it, expect } from "vitest";
import { getBlueprint, getAllBlueprints } from "../src/cycles/blueprints.js";

describe("Hardcoded Blueprints", () => {
  it("has exactly 4 blueprints", () => {
    expect(getAllBlueprints()).toHaveLength(4);
  });

  it("can retrieve each by id", () => {
    expect(getBlueprint("feature-dev")).toBeDefined();
    expect(getBlueprint("debug")).toBeDefined();
    expect(getBlueprint("code-review")).toBeDefined();
    expect(getBlueprint("production-check")).toBeDefined();
  });

  it("returns undefined for unknown id", () => {
    expect(getBlueprint("unknown")).toBeUndefined();
  });

  describe("feature-dev", () => {
    it("has correct node sequence", () => {
      const bp = getBlueprint("feature-dev")!;
      const nodeIds = bp.nodes.map((n) => n.id);
      expect(nodeIds).toEqual([
        "spec", "plan", "write-tests", "implement",
        "typecheck", "lint", "run-tests", "fix", "review", "commit",
      ]);
    });

    it("has spec and plan with skipCondition isSmallTask", () => {
      const bp = getBlueprint("feature-dev")!;
      expect(bp.nodes[0].skipCondition).toBe("isSmallTask");
      expect(bp.nodes[1].skipCondition).toBe("isSmallTask");
    });

    it("has fix node with retryFromNodeId and maxIterations", () => {
      const bp = getBlueprint("feature-dev")!;
      const fix = bp.nodes.find((n) => n.id === "fix")!;
      expect(fix.retryFromNodeId).toBe("typecheck");
      expect(fix.maxIterations).toBe(2);
    });

    it("has deterministic gate nodes", () => {
      const bp = getBlueprint("feature-dev")!;
      const typecheck = bp.nodes.find((n) => n.id === "typecheck")!;
      expect(typecheck.type).toBe("deterministic");
      expect(typecheck.gate).toBeDefined();
      expect(typecheck.gate!.checks[0].type).toBe("typecheck");
    });
  });

  describe("all blueprints", () => {
    it("every blueprint has trigger keywords", () => {
      for (const bp of getAllBlueprints()) {
        expect(bp.trigger.keywords.length, `${bp.id} missing keywords`).toBeGreaterThan(0);
      }
    });

    it("every fix node has retryFromNodeId pointing to a valid node", () => {
      for (const bp of getAllBlueprints()) {
        for (const node of bp.nodes) {
          if (node.retryFromNodeId) {
            const target = bp.nodes.find((n) => n.id === node.retryFromNodeId);
            expect(target, `${bp.id}.${node.id} retryFromNodeId references missing node`).toBeDefined();
          }
        }
      }
    });
  });
});
