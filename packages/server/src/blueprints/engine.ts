import type {
  AgentBackend,
  TaskSpec,
  RunResult,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintEdge,
} from "@patchwork/shared";
import type { SidecarClient } from "../agents/backend.js";
import type { BlueprintRunner } from "./runner.js";
import type { PatchStore } from "../patchwork/store.js";
import { agentLoop } from "../agents/loop.js";
import { collectPatches } from "../patchwork/collector.js";

/**
 * Generic blueprint executor that interprets BlueprintDefinition JSON.
 *
 * Features:
 * - Topological traversal of nodes using edges
 * - Conditional edge traversal (on_success, on_failure, on_timeout, always)
 * - Loop detection with retry counters enforcing maxRetries from retryPolicy
 * - Prompt template expansion with task variables
 *
 * Note: All sidecar method calls (sidecar.exec, etc.) are remote HTTP
 * requests to the sidecar service inside the devbox container — not
 * local child_process calls.
 */
export class BlueprintEngine {
  async execute(
    definition: BlueprintDefinition,
    runner: BlueprintRunner,
    runId: string,
    taskSpec: TaskSpec,
    backendFactory: (role: string) => AgentBackend,
    sidecar: SidecarClient,
    patchStore: PatchStore,
  ): Promise<RunResult> {
    await runner.updateRunStatus(runId, "running");

    // Build edge map: from nodeId → list of edges
    const edgeMap = new Map<string, BlueprintEdge[]>();
    for (const edge of definition.edges) {
      const existing = edgeMap.get(edge.from) || [];
      existing.push(edge);
      edgeMap.set(edge.from, existing);
    }

    // Find start node (node not targeted by any edge, or first node)
    const targetedNodes = new Set(definition.edges.map((e) => e.to));
    const startNode = definition.nodes.find((n) => !targetedNodes.has(n.id))
      ?? definition.nodes[0];

    if (!startNode) {
      await runner.updateRunStatus(runId, "failed");
      return { runId, status: "failed" };
    }

    // Build node lookup
    const nodeMap = new Map<string, BlueprintNode>();
    for (const node of definition.nodes) {
      nodeMap.set(node.id, node);
    }

    // Track retry counters per node
    const retryCounts = new Map<string, number>();

    let currentNodeId: string | null = startNode.id;
    let lastStatus: "success" | "failure" | "timeout" = "success";

    while (currentNodeId) {
      const node = nodeMap.get(currentNodeId);
      if (!node) break;

      // Execute the node
      const nodeResult = await this.executeNode(
        node, runner, runId, taskSpec, backendFactory, sidecar, patchStore
      );
      lastStatus = nodeResult.success ? "success" : "failure";

      // Find next node via edges
      const edges = edgeMap.get(currentNodeId) || [];
      const nextEdge = this.selectEdge(edges, lastStatus);

      if (!nextEdge) {
        // No outgoing edge — we're done
        break;
      }

      // Check retry limits before following a loop-back edge
      const nextNode = nodeMap.get(nextEdge.to);
      if (nextNode && retryCounts.has(nextEdge.to)) {
        const maxRetries = nextNode.retryPolicy?.maxRetries ?? Infinity;
        const count = retryCounts.get(nextEdge.to)!;
        if (count >= maxRetries) {
          // Exceeded retry limit — fail
          lastStatus = "failure";
          break;
        }
      }

      // Track visits for retry counting
      const visits = (retryCounts.get(nextEdge.to) ?? 0) + 1;
      retryCounts.set(nextEdge.to, visits);

      currentNodeId = nextEdge.to;
    }

    const finalStatus = lastStatus === "success" ? "completed" : "failed";
    await runner.updateRunStatus(runId, finalStatus);
    return { runId, status: finalStatus };
  }

  private selectEdge(
    edges: BlueprintEdge[],
    status: "success" | "failure" | "timeout"
  ): BlueprintEdge | undefined {
    // Priority: specific condition match first, then "always"
    const conditionMap: Record<string, string> = {
      success: "on_success",
      failure: "on_failure",
      timeout: "on_timeout",
    };

    const specificEdge = edges.find((e) => e.condition === conditionMap[status]);
    if (specificEdge) return specificEdge;

    return edges.find((e) => e.condition === "always");
  }

  private async executeNode(
    node: BlueprintNode,
    runner: BlueprintRunner,
    runId: string,
    taskSpec: TaskSpec,
    backendFactory: (role: string) => AgentBackend,
    sidecar: SidecarClient,
    _patchStore: PatchStore,
  ): Promise<{ success: boolean; output?: unknown }> {
    if (node.type === "deterministic") {
      return this.executeDeterministicNode(node, runner, runId, sidecar);
    }
    return this.executeAgentNode(node, runner, runId, taskSpec, backendFactory, sidecar);
  }

  private async executeDeterministicNode(
    node: BlueprintNode,
    runner: BlueprintRunner,
    runId: string,
    sidecar: SidecarClient,
  ): Promise<{ success: boolean; output?: unknown }> {
    const step = await runner.createStep(runId, node.id, "deterministic");

    if (!node.command) {
      await runner.completeStep(step.id, { skipped: true });
      return { success: true };
    }

    // Parse command string into cmd + args for the sidecar HTTP endpoint
    const parts = node.command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    const result = await sidecar.exec(cmd, args);
    const success = result.exitCode === 0;
    await runner.completeStep(step.id, { exitCode: result.exitCode, stdout: result.stdout });

    return { success, output: result };
  }

  private async executeAgentNode(
    node: BlueprintNode,
    runner: BlueprintRunner,
    runId: string,
    taskSpec: TaskSpec,
    backendFactory: (role: string) => AgentBackend,
    sidecar: SidecarClient,
  ): Promise<{ success: boolean; output?: unknown }> {
    const config = node.agentConfig;
    if (!config) {
      return { success: false };
    }

    const step = await runner.createStep(runId, node.id, "agent", config.role);
    const backend = backendFactory(config.role);

    const expandedPrompt = this.expandTemplate(config.promptTemplate, taskSpec);
    const expandedContext = this.expandTemplate(config.systemContextTemplate, taskSpec);

    const session = await backend.startSession(runId, {
      role: config.role as "implementer" | "reviewer" | "spec_writer" | "ci_fixer",
      budget: config.budget,
      allowedTools: config.allowedTools,
      systemContext: expandedContext,
    });

    await backend.sendTask(session, expandedPrompt);

    const result = await agentLoop({
      session,
      events: backend.events(session),
      sidecar,
      config: session.config,
      recordEvent: runner.recordEvent.bind(runner),
      collectPatches: () => collectPatches(sidecar, runId, step.id, config.role),
    });

    await runner.completeStep(step.id, result);
    return { success: true, output: result };
  }

  private expandTemplate(template: string, taskSpec: TaskSpec): string {
    return template
      .replace(/\{\{task_description\}\}/g, taskSpec.description)
      .replace(/\{\{repo\}\}/g, taskSpec.repo)
      .replace(/\{\{branch\}\}/g, taskSpec.branch);
  }
}
