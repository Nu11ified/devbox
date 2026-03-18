import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Blueprint } from "./types.js";

/** IDs of hardcoded blueprints — custom configs must not collide */
const HARDCODED_IDS = new Set(["feature-dev", "debug", "code-review", "production-check"]);

/**
 * Load custom cycle configurations from .patchwork/cycles/*.json
 * Returns valid Blueprint objects, skipping invalid or colliding configs.
 */
export function loadCustomCycles(workspacePath: string): Blueprint[] {
  const cyclesDir = join(workspacePath, ".patchwork", "cycles");

  if (!existsSync(cyclesDir)) {
    return [];
  }

  const files = readdirSync(cyclesDir).filter((f: string) => f.endsWith(".json"));
  const blueprints: Blueprint[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(cyclesDir, file), "utf-8");
      const config = JSON.parse(content);

      // Check for collision with hardcoded IDs
      if (HARDCODED_IDS.has(config.id)) {
        console.warn(`[cycle-loader] Skipping ${file}: ID "${config.id}" collides with a built-in cycle`);
        continue;
      }

      const error = validateBlueprint(config);
      if (error) {
        console.warn(`[cycle-loader] Skipping ${file}: ${error}`);
        continue;
      }

      blueprints.push(config as Blueprint);
    } catch (err: any) {
      console.warn(`[cycle-loader] Failed to load ${file}: ${err.message}`);
    }
  }

  return blueprints;
}

/**
 * Validate a blueprint configuration.
 * Returns null if valid, or an error string describing the issue.
 */
export function validateBlueprint(bp: any): string | null {
  // Required fields
  if (!bp.id || typeof bp.id !== "string") return "Missing required field: id";
  if (!bp.name || typeof bp.name !== "string") return "Missing required field: name";
  if (!bp.description || typeof bp.description !== "string") return "Missing required field: description";
  if (!bp.trigger?.keywords || !Array.isArray(bp.trigger.keywords) || bp.trigger.keywords.length === 0) {
    return "Missing required field: trigger.keywords (must be non-empty array)";
  }
  if (!Array.isArray(bp.nodes) || bp.nodes.length === 0) {
    return "Missing required field: nodes (must be non-empty array)";
  }

  // Validate nodes
  const nodeIds = new Set<string>();
  for (const node of bp.nodes) {
    if (!node.id || !node.name || !node.type) {
      return `Node missing required fields (id, name, type)`;
    }
    if (node.type !== "agentic" && node.type !== "deterministic") {
      return `Node "${node.id}" has invalid type: ${node.type}`;
    }
    if (nodeIds.has(node.id)) {
      return `Nodes contain duplicate id: "${node.id}"`;
    }
    nodeIds.add(node.id);
  }

  // Validate maxIterations
  for (const node of bp.nodes) {
    if (node.maxIterations !== undefined) {
      if (typeof node.maxIterations !== "number" || node.maxIterations < 1 || node.maxIterations > 5) {
        return `Node "${node.id}" has maxIterations out of range (must be 1-5)`;
      }
    }
  }

  // Validate retryFromNodeId
  for (const node of bp.nodes) {
    if (node.retryFromNodeId) {
      if (!nodeIds.has(node.retryFromNodeId)) {
        return `Node "${node.id}" has retryFromNodeId "${node.retryFromNodeId}" referencing non-existent node`;
      }
    }
  }

  return null;
}
