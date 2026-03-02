import { describe, it, expect } from "vitest";
import type { BlueprintDefinition } from "@patchwork/shared";
import { WRITER_REVIEWER_BLUEPRINT } from "../src/blueprints/writer-reviewer.js";
import { SPEC_IMPLEMENT_REVIEW_BLUEPRINT } from "../src/blueprints/spec-implement-review.js";
import { BUILTIN_BLUEPRINTS } from "../src/blueprints/definitions.js";

// --- Writer-Reviewer Blueprint ---

describe("WRITER_REVIEWER_BLUEPRINT", () => {
  it("is a valid BlueprintDefinition", () => {
    const bp: BlueprintDefinition = WRITER_REVIEWER_BLUEPRINT;
    expect(bp.id).toBe("writer-reviewer");
    expect(bp.name).toBeDefined();
    expect(bp.version).toBeGreaterThanOrEqual(1);
    expect(bp.nodes.length).toBeGreaterThanOrEqual(2);
    expect(bp.edges.length).toBeGreaterThanOrEqual(1);
  });

  it("has implement node using Claude as preferred backend", () => {
    const implement = WRITER_REVIEWER_BLUEPRINT.nodes.find(n => n.id === "implement");
    expect(implement).toBeDefined();
    expect(implement!.type).toBe("agent");
    expect(implement!.agentConfig).toBeDefined();
    expect(implement!.agentConfig!.preferredBackends).toContain("claude");
    expect(implement!.agentConfig!.role).toBe("implementer");
  });

  it("has review node using Codex as preferred backend", () => {
    const review = WRITER_REVIEWER_BLUEPRINT.nodes.find(n => n.id === "review");
    expect(review).toBeDefined();
    expect(review!.type).toBe("agent");
    expect(review!.agentConfig).toBeDefined();
    expect(review!.agentConfig!.preferredBackends[0]).toBe("codex");
    expect(review!.agentConfig!.role).toBe("reviewer");
  });

  it("has apply_fixes node for incorporating review feedback", () => {
    const fix = WRITER_REVIEWER_BLUEPRINT.nodes.find(n => n.id === "apply_fixes");
    expect(fix).toBeDefined();
    expect(fix!.type).toBe("agent");
    expect(fix!.agentConfig!.role).toBe("ci_fixer");
  });

  it("has merge node at the end", () => {
    const merge = WRITER_REVIEWER_BLUEPRINT.nodes.find(n => n.id === "merge");
    expect(merge).toBeDefined();
    expect(merge!.type).toBe("deterministic");
  });

  it("follows implement → review → apply_fixes → merge ordering", () => {
    const edges = WRITER_REVIEWER_BLUEPRINT.edges;

    // implement → review
    expect(edges.find(e => e.from === "implement" && e.to === "review")).toBeDefined();
    // review → apply_fixes (on_failure = needs changes)
    expect(edges.find(e => e.from === "review" && e.to === "apply_fixes")).toBeDefined();
    // review → merge (on_success = approved)
    expect(edges.find(e => e.from === "review" && e.to === "merge")).toBeDefined();
    // apply_fixes → review (loop back)
    expect(edges.find(e => e.from === "apply_fixes" && e.to === "review")).toBeDefined();
  });

  it("has review node with retry policy for review loop", () => {
    const review = WRITER_REVIEWER_BLUEPRINT.nodes.find(n => n.id === "review");
    expect(review?.retryPolicy).toBeDefined();
    expect(review!.retryPolicy!.maxRetries).toBeGreaterThanOrEqual(2);
  });
});

// --- Spec-Implement-Review Blueprint ---

describe("SPEC_IMPLEMENT_REVIEW_BLUEPRINT", () => {
  it("is a valid BlueprintDefinition", () => {
    const bp: BlueprintDefinition = SPEC_IMPLEMENT_REVIEW_BLUEPRINT;
    expect(bp.id).toBe("spec-implement-review");
    expect(bp.name).toBeDefined();
    expect(bp.version).toBeGreaterThanOrEqual(1);
    expect(bp.nodes.length).toBeGreaterThanOrEqual(3);
    expect(bp.edges.length).toBeGreaterThanOrEqual(2);
  });

  it("has spec_write node using Claude", () => {
    const spec = SPEC_IMPLEMENT_REVIEW_BLUEPRINT.nodes.find(n => n.id === "spec_write");
    expect(spec).toBeDefined();
    expect(spec!.type).toBe("agent");
    expect(spec!.agentConfig).toBeDefined();
    expect(spec!.agentConfig!.preferredBackends).toContain("claude");
    expect(spec!.agentConfig!.role).toBe("spec_writer");
  });

  it("has implement node using Codex", () => {
    const implement = SPEC_IMPLEMENT_REVIEW_BLUEPRINT.nodes.find(n => n.id === "implement");
    expect(implement).toBeDefined();
    expect(implement!.type).toBe("agent");
    expect(implement!.agentConfig!.preferredBackends[0]).toBe("codex");
    expect(implement!.agentConfig!.role).toBe("implementer");
  });

  it("has review node using Claude", () => {
    const review = SPEC_IMPLEMENT_REVIEW_BLUEPRINT.nodes.find(n => n.id === "review");
    expect(review).toBeDefined();
    expect(review!.type).toBe("agent");
    expect(review!.agentConfig!.preferredBackends[0]).toBe("claude");
    expect(review!.agentConfig!.role).toBe("reviewer");
  });

  it("has merge node at the end", () => {
    const merge = SPEC_IMPLEMENT_REVIEW_BLUEPRINT.nodes.find(n => n.id === "merge");
    expect(merge).toBeDefined();
    expect(merge!.type).toBe("deterministic");
  });

  it("follows spec_write → implement → review → merge ordering", () => {
    const edges = SPEC_IMPLEMENT_REVIEW_BLUEPRINT.edges;

    // spec_write → implement
    expect(edges.find(e => e.from === "spec_write" && e.to === "implement")).toBeDefined();
    // implement → review
    expect(edges.find(e => e.from === "implement" && e.to === "review")).toBeDefined();
    // review → merge (on_success)
    expect(edges.find(e => e.from === "review" && e.to === "merge")).toBeDefined();
  });

  it("has three distinct agent roles", () => {
    const agentNodes = SPEC_IMPLEMENT_REVIEW_BLUEPRINT.nodes.filter(n => n.type === "agent");
    const roles = agentNodes.map(n => n.agentConfig!.role);
    expect(new Set(roles).size).toBeGreaterThanOrEqual(3);
  });
});

// --- BUILTIN_BLUEPRINTS registration ---

describe("BUILTIN_BLUEPRINTS includes multi-agent patterns", () => {
  it("contains writer-reviewer blueprint", () => {
    expect(BUILTIN_BLUEPRINTS.has("writer-reviewer")).toBe(true);
    expect(BUILTIN_BLUEPRINTS.get("writer-reviewer")).toBe(WRITER_REVIEWER_BLUEPRINT);
  });

  it("contains spec-implement-review blueprint", () => {
    expect(BUILTIN_BLUEPRINTS.has("spec-implement-review")).toBe(true);
    expect(BUILTIN_BLUEPRINTS.get("spec-implement-review")).toBe(SPEC_IMPLEMENT_REVIEW_BLUEPRINT);
  });

  it("still contains simple and minion blueprints", () => {
    expect(BUILTIN_BLUEPRINTS.has("simple")).toBe(true);
    expect(BUILTIN_BLUEPRINTS.has("minion")).toBe(true);
  });

  it("has 4 total blueprints", () => {
    expect(BUILTIN_BLUEPRINTS.size).toBe(4);
  });
});
