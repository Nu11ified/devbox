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

import { z } from "zod";
import prisma from "../../db/prisma.js";
import { CycleEngine } from "../../cycles/engine.js";
import { getBlueprint } from "../../cycles/blueprints.js";

interface CustomToolContext {
  threadId: string;
  projectId?: string;
  userId?: string;
  workspacePath: string;
}

/** Helper to build an MCP text result */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
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
    const sdkTool = (sdk as any).tool;

    if (!createSdkMcpServer || !sdkTool) {
      console.log("[custom-tools] SDK does not export createSdkMcpServer/tool, skipping custom tools");
      return undefined;
    }

    return createSdkMcpServer({
      tools: [
        // ─── Project/Thread tools ────────────────────────────────────

        sdkTool(
          "patchwork_get_project",
          "Get information about the current Patchwork project including name, repo, branch, and status.",
          {},
          async () => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
            }
            const project = await prisma.project.findUnique({
              where: { id: ctx.projectId },
            });
            if (!project) {
              return textResult("Project not found.");
            }
            return textResult(JSON.stringify({
              id: project.id,
              name: project.name,
              repo: project.repo,
              branch: project.branch,
              status: project.status,
              workspacePath: project.workspacePath,
            }));
          },
        ),

        sdkTool(
          "patchwork_list_threads",
          "List other threads in the same project. Useful for understanding related work.",
          {},
          async () => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
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
            return textResult(JSON.stringify(threads));
          },
        ),

        sdkTool(
          "patchwork_list_issues",
          "List issues in the current project. Shows open issues that may need work.",
          {},
          async () => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
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
            return textResult(JSON.stringify(issues));
          },
        ),

        sdkTool(
          "patchwork_create_issue",
          "Create an issue in the current Patchwork project for tracking work.",
          {
            title: z.string().describe("Issue title"),
            body: z.string().optional().describe("Issue description/details"),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional().describe("Priority level"),
            labels: z.array(z.string()).optional().describe("Labels to apply"),
          },
          async (input: { title: string; body?: string; priority?: string; labels?: string[] }) => {
            if (!ctx.projectId) {
              return textResult("Cannot create issue: no project associated with this thread.");
            }
            const project = await prisma.project.findUnique({
              where: { id: ctx.projectId },
              select: { repo: true },
            });
            const priorityMap: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };
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
            return textResult(JSON.stringify({ id: issue.id, title: issue.title, status: issue.status }));
          },
        ),

        sdkTool(
          "patchwork_update_thread_title",
          "Update the title of the current thread to better reflect the work being done.",
          {
            title: z.string().describe("New thread title"),
          },
          async (input: { title: string }) => {
            await prisma.thread.update({
              where: { id: ctx.threadId },
              data: { title: input.title },
            });
            return textResult(`Thread title updated to: ${input.title}`);
          },
        ),

        // ─── Anki tools ──────────────────────────────────────────────

        sdkTool(
          "anki_list",
          "List all Anki cards for the current project (table of contents). Optionally filter by group or include stale cards.",
          {
            group: z.string().optional().describe("Filter by group name"),
            includeStale: z.boolean().optional().describe("Include stale/outdated cards (default: false)"),
          },
          async (input: { group?: string; includeStale?: boolean }) => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
            }
            const where: any = { projectId: ctx.projectId };
            if (input.group) {
              where.group = input.group;
            }
            if (!input.includeStale) {
              where.stale = false;
            }
            const [cards, totalCount] = await Promise.all([
              prisma.ankiCard.findMany({
                where,
                orderBy: { accessCount: "desc" },
                take: 100,
                select: {
                  id: true,
                  group: true,
                  title: true,
                  stale: true,
                  staleReason: true,
                  accessCount: true,
                  lastAccessedAt: true,
                  updatedAt: true,
                },
              }),
              prisma.ankiCard.count({ where }),
            ]);
            const result: any = { cards, totalCount };
            if (totalCount > 100) {
              result.truncated = true;
            }
            return textResult(JSON.stringify(result));
          },
        ),

        sdkTool(
          "anki_read",
          "Fetch the full contents of an Anki card by group and title. Increments the access counter.",
          {
            group: z.string().describe("Card group name"),
            title: z.string().describe("Card title"),
          },
          async (input: { group: string; title: string }) => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
            }
            const card = await prisma.ankiCard.findUnique({
              where: {
                projectId_group_title: {
                  projectId: ctx.projectId,
                  group: input.group.toLowerCase(),
                  title: input.title,
                },
              },
            });
            if (!card) {
              return textResult(JSON.stringify({ error: "Card not found" }));
            }
            await prisma.ankiCard.update({
              where: { id: card.id },
              data: {
                accessCount: { increment: 1 },
                lastAccessedAt: new Date(),
              },
            });
            return textResult(JSON.stringify(card));
          },
        ),

        sdkTool(
          "anki_write",
          "Create or update an Anki card for the current project. Use this to store knowledge, decisions, or context that should persist across sessions.",
          {
            group: z.string().describe("Card group/category (e.g. 'architecture', 'decisions')"),
            title: z.string().describe("Card title"),
            contents: z.string().describe("Card contents in markdown"),
            referencedFiles: z.array(z.string()).optional().describe("File paths referenced by this card"),
          },
          async (input: { group: string; title: string; contents: string; referencedFiles?: string[] }) => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
            }
            const group = input.group
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 50);
            const title = input.title.slice(0, 200);
            const contents = input.contents.slice(0, 10000);
            const referencedFiles = (input.referencedFiles ?? []).slice(0, 20);

            const existing = await prisma.ankiCard.findUnique({
              where: {
                projectId_group_title: {
                  projectId: ctx.projectId,
                  group,
                  title,
                },
              },
              select: { id: true },
            });

            const card = await prisma.ankiCard.upsert({
              where: {
                projectId_group_title: {
                  projectId: ctx.projectId,
                  group,
                  title,
                },
              },
              create: {
                projectId: ctx.projectId,
                group,
                title,
                contents,
                referencedFiles,
                createdByThreadId: ctx.threadId,
                updatedByThreadId: ctx.threadId,
              },
              update: {
                contents,
                referencedFiles,
                stale: false,
                staleReason: null,
                lastVerifiedAt: new Date(),
                updatedByThreadId: ctx.threadId,
              },
              select: { id: true },
            });

            return textResult(JSON.stringify({ created: !existing, cardId: card.id }));
          },
        ),

        sdkTool(
          "anki_invalidate",
          "Mark an Anki card as stale/outdated with a reason. Use when you know a card's contents are no longer accurate.",
          {
            group: z.string().describe("Card group name"),
            title: z.string().describe("Card title"),
            reason: z.string().describe("Reason why the card is now stale/outdated"),
          },
          async (input: { group: string; title: string; reason: string }) => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
            }
            try {
              await prisma.ankiCard.update({
                where: {
                  projectId_group_title: {
                    projectId: ctx.projectId,
                    group: input.group,
                    title: input.title,
                  },
                },
                data: {
                  stale: true,
                  staleReason: input.reason,
                },
              });
              return textResult(JSON.stringify({ success: true }));
            } catch (err: any) {
              if (err.code === "P2025") {
                return textResult(JSON.stringify({ success: false, error: "Card not found" }));
              }
              throw err;
            }
          },
        ),

        sdkTool(
          "anki_delete",
          "Permanently delete an Anki card from the current project.",
          {
            group: z.string().describe("Card group name"),
            title: z.string().describe("Card title"),
          },
          async (input: { group: string; title: string }) => {
            if (!ctx.projectId) {
              return textResult("No project associated with this thread.");
            }
            try {
              await prisma.ankiCard.delete({
                where: {
                  projectId_group_title: {
                    projectId: ctx.projectId,
                    group: input.group,
                    title: input.title,
                  },
                },
              });
              return textResult(JSON.stringify({ success: true }));
            } catch (err: any) {
              if (err.code === "P2025") {
                return textResult(JSON.stringify({ success: false }));
              }
              throw err;
            }
          },
        ),

        // ─── Cycle tools ─────────────────────────────────────────────

        sdkTool(
          "cycle_start",
          "Start a structured development cycle. Available cycles: feature-dev, debug, code-review, production-check.",
          {
            blueprintId: z.string().describe("Cycle ID to start (e.g. 'feature-dev', 'debug')"),
          },
          async (input: { blueprintId: string }) => {
            const blueprint = getBlueprint(input.blueprintId);
            if (!blueprint) {
              return textResult(`Unknown cycle: ${input.blueprintId}. Available: feature-dev, debug, code-review, production-check`);
            }

            const engine = new CycleEngine((event) => {
              console.log(`[cycle] ${event.type}`, JSON.stringify(event));
            });

            const run = await engine.startCycle(blueprint, ctx.threadId, ctx.workspacePath);
            const firstNode = blueprint.nodes[0];
            return textResult(JSON.stringify({
              runId: run.id,
              cycle: blueprint.name,
              currentPhase: firstNode.name,
              phaseIndex: 1,
              totalPhases: blueprint.nodes.length,
              prompt: engine.getPhasePrompt(blueprint, 0),
            }));
          },
        ),

        sdkTool(
          "cycle_status",
          "Get the current status of the active development cycle for this thread.",
          {},
          async () => {
            const run = await prisma.cycleRun.findFirst({
              where: { threadId: ctx.threadId, status: "running" },
              include: { nodeResults: { orderBy: { createdAt: "asc" } } },
            });
            if (!run) {
              return textResult(JSON.stringify({ active: false }));
            }
            const blueprint = getBlueprint(run.blueprintId);
            const currentNode = blueprint?.nodes[run.currentNodeIndex];
            return textResult(JSON.stringify({
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
            }));
          },
        ),

        sdkTool(
          "cycle_advance",
          "Signal that the current agentic phase is complete and advance to the next phase. If the next phase is a deterministic gate, it runs automatically and returns the results.",
          {},
          async () => {
            const run = await prisma.cycleRun.findFirst({
              where: { threadId: ctx.threadId, status: "running" },
            });
            if (!run) {
              return textResult("No active cycle to advance.");
            }
            const blueprint = getBlueprint(run.blueprintId);
            if (!blueprint) {
              return textResult(`Blueprint not found: ${run.blueprintId}`);
            }

            const engine = new CycleEngine((event) => {
              console.log(`[cycle] ${event.type}`, JSON.stringify(event));
            });

            const result = await engine.advanceAgenticNode(run.id, blueprint, ctx.workspacePath);

            if (result.completed) {
              return textResult(JSON.stringify({ completed: true, message: "Cycle completed successfully!" }));
            }

            const nextNode = result.nextNode!;

            if (nextNode.type === "deterministic") {
              const nextIndex = blueprint.nodes.findIndex((n) => n.id === nextNode.id);
              const gateResult = await engine.runDeterministicNode(run.id, blueprint, nextIndex, ctx.workspacePath);

              return textResult(JSON.stringify({
                phase: nextNode.name,
                phaseType: "deterministic",
                gateResults: gateResult.gateResults,
                passed: gateResult.passed,
                action: gateResult.action,
                fixNodeId: gateResult.fixNodeId,
                nextPrompt: gateResult.action === "retry" && gateResult.fixNodeId
                  ? engine.getPhasePrompt(blueprint, blueprint.nodes.findIndex((n) => n.id === gateResult.fixNodeId))
                  : undefined,
              }));
            }

            return textResult(JSON.stringify({
              phase: nextNode.name,
              phaseType: "agentic",
              phaseIndex: blueprint.nodes.findIndex((n) => n.id === nextNode.id) + 1,
              totalPhases: blueprint.nodes.length,
              prompt: engine.getPhasePrompt(blueprint, blueprint.nodes.findIndex((n) => n.id === nextNode.id)),
            }));
          },
        ),

        sdkTool(
          "cycle_skip",
          "Skip a pending phase in the current cycle. Use for small/routine tasks that don't need full cycle phases.",
          {
            nodeId: z.string().describe("ID of the node/phase to skip"),
            reason: z.string().describe("Brief reason for skipping"),
          },
          async (input: { nodeId: string; reason: string }) => {
            const run = await prisma.cycleRun.findFirst({
              where: { threadId: ctx.threadId, status: "running" },
              include: { nodeResults: true },
            });
            if (!run) {
              return textResult("No active cycle.");
            }
            const blueprint = getBlueprint(run.blueprintId);
            if (!blueprint) {
              return textResult(`Blueprint not found: ${run.blueprintId}`);
            }

            const nodeIndex = blueprint.nodes.findIndex((n) => n.id === input.nodeId);
            if (nodeIndex < 0) {
              return textResult(`Node not found: ${input.nodeId}`);
            }
            if (nodeIndex < run.currentNodeIndex) {
              return textResult(`Cannot skip: node ${input.nodeId} is already past.`);
            }

            const nodeResult = (run.nodeResults as any[]).find((nr: any) => nr.nodeId === input.nodeId);
            if (nodeResult) {
              await prisma.cycleNodeResult.update({
                where: { id: nodeResult.id },
                data: { status: "skipped", completedAt: new Date() },
              });
            }

            if (nodeIndex === run.currentNodeIndex) {
              const nextIndex = run.currentNodeIndex + 1;
              if (nextIndex >= blueprint.nodes.length) {
                const engine = new CycleEngine((event) => {
                  console.log(`[cycle] ${event.type}`, JSON.stringify(event));
                });
                await engine.completeCycle(run.id);
                return textResult(JSON.stringify({ skipped: true, nodeId: input.nodeId, reason: input.reason, completed: true }));
              }
              await prisma.cycleRun.update({
                where: { id: run.id },
                data: { currentNodeIndex: nextIndex },
              });
            }

            return textResult(JSON.stringify({ skipped: true, nodeId: input.nodeId, reason: input.reason }));
          },
        ),
      ],
    });
  } catch (err: any) {
    console.log(`[custom-tools] Failed to create MCP server: ${err.message}`);
    return undefined;
  }
}
