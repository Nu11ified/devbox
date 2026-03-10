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
      ],
    });
  } catch (err: any) {
    console.log(`[custom-tools] Failed to create MCP server: ${err.message}`);
    return undefined;
  }
}
