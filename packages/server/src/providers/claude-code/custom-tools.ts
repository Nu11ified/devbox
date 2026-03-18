/**
 * Custom tools for the Claude Agent SDK via in-process MCP server.
 *
 * These expose Patchwork-specific functionality to the agent:
 * - Project/thread metadata lookup
 * - Issue creation and management
 * - PR creation helpers
 *
 * Uses createSdkMcpServer + tool() from the SDK.
 * Falls back gracefully if these exports aren't available in the installed SDK version.
 */

import prisma from "../../db/prisma.js";
import { CycleEngine } from "../../cycles/engine.js";
import { getBlueprint } from "../../cycles/blueprints.js";

interface CustomToolContext {
  threadId: string;
  projectId?: string;
  userId?: string;
  workspacePath: string;
}

/**
 * Attempt to create an MCP server with Patchwork tools.
 * Returns undefined if the SDK doesn't export the required helpers.
 */
export async function createPatchworkMcpServer(
  ctx: CustomToolContext
): Promise<any | undefined> {
  try {
    // Dynamic import to handle SDK versions that may not export these
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    const createSdkMcpServer = (sdk as any).createSdkMcpServer;
    const tool = (sdk as any).tool;

    if (!createSdkMcpServer || !tool) {
      console.log("[custom-tools] SDK does not export createSdkMcpServer/tool, skipping custom tools");
      return undefined;
    }

    return createSdkMcpServer({
      tools: [
        tool({
          name: "patchwork_get_project",
          description:
            "Get information about the current Patchwork project including name, repo, branch, and status.",
          inputSchema: { type: "object" as const, properties: {} },
          handler: async () => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
            }
            const project = await prisma.project.findUnique({
              where: { id: ctx.projectId },
            });
            if (!project) {
              return { text: "Project not found." };
            }
            return {
              text: JSON.stringify({
                id: project.id,
                name: project.name,
                repo: project.repo,
                branch: project.branch,
                status: project.status,
                workspacePath: project.workspacePath,
              }),
            };
          },
        }),

        tool({
          name: "patchwork_list_threads",
          description:
            "List other threads in the same project. Useful for understanding related work.",
          inputSchema: { type: "object" as const, properties: {} },
          handler: async () => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
            }
            const threads = await prisma.thread.findMany({
              where: { projectId: ctx.projectId, archivedAt: null },
              orderBy: { updatedAt: "desc" },
              take: 10,
              select: {
                id: true,
                title: true,
                status: true,
                worktreeBranch: true,
                updatedAt: true,
              },
            });
            return { text: JSON.stringify(threads) };
          },
        }),

        tool({
          name: "patchwork_list_issues",
          description:
            "List issues in the current project. Shows open issues that may need work.",
          inputSchema: { type: "object" as const, properties: {} },
          handler: async () => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
            }
            const issues = await prisma.issue.findMany({
              where: { projectId: ctx.projectId },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                title: true,
                body: true,
                status: true,
                priority: true,
                labels: true,
                createdAt: true,
              },
            });
            return { text: JSON.stringify(issues) };
          },
        }),

        tool({
          name: "patchwork_create_issue",
          description:
            "Create an issue in the current Patchwork project for tracking work.",
          inputSchema: {
            type: "object" as const,
            properties: {
              title: { type: "string", description: "Issue title" },
              body: { type: "string", description: "Issue description/details" },
              priority: {
                type: "string",
                enum: ["low", "medium", "high", "urgent"],
                description: "Priority level",
              },
              labels: {
                type: "array",
                items: { type: "string" },
                description: "Labels to apply",
              },
            },
            required: ["title"],
          },
          handler: async (input: {
            title: string;
            body?: string;
            priority?: string;
            labels?: string[];
          }) => {
            if (!ctx.projectId) {
              return { text: "Cannot create issue: no project associated with this thread." };
            }
            // Resolve project repo for the required `repo` field
            const project = await prisma.project.findUnique({
              where: { id: ctx.projectId },
              select: { repo: true },
            });
            const priorityMap: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
            // Generate a unique identifier (e.g., AGENT-1234)
            const shortId = Math.floor(Math.random() * 9000 + 1000);
            const issue = await prisma.issue.create({
              data: {
                projectId: ctx.projectId,
                identifier: `AGENT-${shortId}`,
                repo: project?.repo ?? "unknown",
                title: input.title,
                body: input.body ?? "",
                status: "open",
                priority: priorityMap[input.priority ?? "medium"] ?? 1,
                labels: input.labels ?? [],
              },
            });
            return { text: JSON.stringify({ id: issue.id, title: issue.title, status: issue.status }) };
          },
        }),

        tool({
          name: "patchwork_update_thread_title",
          description:
            "Update the title of the current thread to better reflect the work being done.",
          inputSchema: {
            type: "object" as const,
            properties: {
              title: { type: "string", description: "New thread title" },
            },
            required: ["title"],
          },
          handler: async (input: { title: string }) => {
            await prisma.thread.update({
              where: { id: ctx.threadId },
              data: { title: input.title },
            });
            return { text: `Thread title updated to: ${input.title}` };
          },
        }),

        tool({
          name: "cycle_start",
          description: "Start a structured development cycle. Available cycles: feature-dev, debug, code-review, production-check.",
          inputSchema: {
            type: "object" as const,
            properties: {
              blueprintId: { type: "string", description: "Cycle ID to start (e.g. 'feature-dev', 'debug')" },
            },
            required: ["blueprintId"],
          },
          handler: async (input: { blueprintId: string }) => {
            const blueprint = getBlueprint(input.blueprintId);
            if (!blueprint) {
              return { text: `Unknown cycle: ${input.blueprintId}. Available: feature-dev, debug, code-review, production-check` };
            }

            const engine = new CycleEngine((event) => {
              // Events will be picked up by the provider event system
              console.log(`[cycle] ${event.type}`, JSON.stringify(event));
            });

            const run = await engine.startCycle(blueprint, ctx.threadId, ctx.workspacePath);
            const firstNode = blueprint.nodes[0];
            return {
              text: JSON.stringify({
                runId: run.id,
                cycle: blueprint.name,
                currentPhase: firstNode.name,
                phaseIndex: 1,
                totalPhases: blueprint.nodes.length,
                prompt: engine.getPhasePrompt(blueprint, 0),
              }),
            };
          },
        }),

        tool({
          name: "cycle_status",
          description: "Get the current status of the active development cycle for this thread.",
          inputSchema: { type: "object" as const, properties: {} },
          handler: async () => {
            const run = await prisma.cycleRun.findFirst({
              where: { threadId: ctx.threadId, status: "running" },
              include: { nodeResults: { orderBy: { createdAt: "asc" } } },
            });
            if (!run) {
              return { text: JSON.stringify({ active: false }) };
            }
            const blueprint = getBlueprint(run.blueprintId);
            const currentNode = blueprint?.nodes[run.currentNodeIndex];
            return {
              text: JSON.stringify({
                active: true,
                runId: run.id,
                blueprintId: run.blueprintId,
                cycleName: blueprint?.name,
                currentPhase: currentNode?.name,
                phaseIndex: run.currentNodeIndex + 1,
                totalPhases: blueprint?.nodes.length,
                status: run.status,
                nodeResults: run.nodeResults.map((nr: any) => ({
                  nodeId: nr.nodeId,
                  status: nr.status,
                  iterations: nr.iterations,
                })),
              }),
            };
          },
        }),

        tool({
          name: "cycle_advance",
          description: "Signal that the current agentic phase is complete and advance to the next phase. If the next phase is a deterministic gate, it runs automatically and returns the results.",
          inputSchema: { type: "object" as const, properties: {} },
          handler: async () => {
            const run = await prisma.cycleRun.findFirst({
              where: { threadId: ctx.threadId, status: "running" },
            });
            if (!run) {
              return { text: "No active cycle to advance." };
            }
            const blueprint = getBlueprint(run.blueprintId);
            if (!blueprint) {
              return { text: `Blueprint not found: ${run.blueprintId}` };
            }

            const engine = new CycleEngine((event) => {
              console.log(`[cycle] ${event.type}`, JSON.stringify(event));
            });

            const result = await engine.advanceAgenticNode(run.id, blueprint, ctx.workspacePath);

            if (result.completed) {
              return { text: JSON.stringify({ completed: true, message: "Cycle completed successfully!" }) };
            }

            const nextNode = result.nextNode!;

            // If next node is deterministic, run it automatically
            if (nextNode.type === "deterministic") {
              const nextIndex = blueprint.nodes.findIndex((n) => n.id === nextNode.id);
              const gateResult = await engine.runDeterministicNode(run.id, blueprint, nextIndex, ctx.workspacePath);

              return {
                text: JSON.stringify({
                  phase: nextNode.name,
                  phaseType: "deterministic",
                  gateResults: gateResult.gateResults,
                  passed: gateResult.passed,
                  action: gateResult.action,
                  fixNodeId: gateResult.fixNodeId,
                  nextPrompt: gateResult.action === "retry" && gateResult.fixNodeId
                    ? engine.getPhasePrompt(blueprint, blueprint.nodes.findIndex((n) => n.id === gateResult.fixNodeId))
                    : undefined,
                }),
              };
            }

            return {
              text: JSON.stringify({
                phase: nextNode.name,
                phaseType: "agentic",
                phaseIndex: blueprint.nodes.findIndex((n) => n.id === nextNode.id) + 1,
                totalPhases: blueprint.nodes.length,
                prompt: engine.getPhasePrompt(blueprint, blueprint.nodes.findIndex((n) => n.id === nextNode.id)),
              }),
            };
          },
        }),

        tool({
          name: "cycle_skip",
          description: "Skip a pending phase in the current cycle. Use for small/routine tasks that don't need full cycle phases.",
          inputSchema: {
            type: "object" as const,
            properties: {
              nodeId: { type: "string", description: "ID of the node/phase to skip" },
              reason: { type: "string", description: "Brief reason for skipping" },
            },
            required: ["nodeId", "reason"],
          },
          handler: async (input: { nodeId: string; reason: string }) => {
            const run = await prisma.cycleRun.findFirst({
              where: { threadId: ctx.threadId, status: "running" },
              include: { nodeResults: true },
            });
            if (!run) {
              return { text: "No active cycle." };
            }
            const blueprint = getBlueprint(run.blueprintId);
            if (!blueprint) {
              return { text: `Blueprint not found: ${run.blueprintId}` };
            }

            const nodeIndex = blueprint.nodes.findIndex((n) => n.id === input.nodeId);
            if (nodeIndex < 0) {
              return { text: `Node not found: ${input.nodeId}` };
            }
            if (nodeIndex < run.currentNodeIndex) {
              return { text: `Cannot skip: node ${input.nodeId} is already past.` };
            }

            // Mark node as skipped
            const nodeResult = (run.nodeResults as any[]).find((nr: any) => nr.nodeId === input.nodeId);
            if (nodeResult) {
              await prisma.cycleNodeResult.update({
                where: { id: nodeResult.id },
                data: { status: "skipped", completedAt: new Date() },
              });
            }

            // If skipping the current node, advance the index
            if (nodeIndex === run.currentNodeIndex) {
              const nextIndex = run.currentNodeIndex + 1;
              if (nextIndex >= blueprint.nodes.length) {
                // Skipping the last node completes the cycle
                const engine = new CycleEngine((event) => {
                  console.log(`[cycle] ${event.type}`, JSON.stringify(event));
                });
                await engine.completeCycle(run.id);
                return { text: JSON.stringify({ skipped: true, nodeId: input.nodeId, reason: input.reason, completed: true }) };
              }
              await prisma.cycleRun.update({
                where: { id: run.id },
                data: { currentNodeIndex: nextIndex },
              });
            }

            return { text: JSON.stringify({ skipped: true, nodeId: input.nodeId, reason: input.reason }) };
          },
        }),
      ],
    });
  } catch (err: any) {
    console.log(`[custom-tools] Failed to create MCP server: ${err.message}`);
    return undefined;
  }
}
