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

        tool({
          name: "anki_list",
          description:
            "List all Anki cards for the current project (table of contents). Optionally filter by group or include stale cards.",
          inputSchema: {
            type: "object" as const,
            properties: {
              group: { type: "string", description: "Filter by group name" },
              includeStale: {
                type: "boolean",
                description: "Include stale/outdated cards (default: false)",
              },
            },
          },
          handler: async (input: { group?: string; includeStale?: boolean }) => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
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
            return { text: JSON.stringify(result) };
          },
        }),

        tool({
          name: "anki_read",
          description:
            "Fetch the full contents of an Anki card by group and title. Increments the access counter.",
          inputSchema: {
            type: "object" as const,
            properties: {
              group: { type: "string", description: "Card group name" },
              title: { type: "string", description: "Card title" },
            },
            required: ["group", "title"],
          },
          handler: async (input: { group: string; title: string }) => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
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
              return { text: JSON.stringify({ error: "Card not found" }) };
            }
            // Atomically increment accessCount and update lastAccessedAt
            await prisma.ankiCard.update({
              where: { id: card.id },
              data: {
                accessCount: { increment: 1 },
                lastAccessedAt: new Date(),
              },
            });
            return { text: JSON.stringify(card) };
          },
        }),

        tool({
          name: "anki_write",
          description:
            "Create or update an Anki card for the current project. Use this to store knowledge, decisions, or context that should persist across sessions.",
          inputSchema: {
            type: "object" as const,
            properties: {
              group: {
                type: "string",
                description: "Card group/category (e.g. 'architecture', 'decisions')",
              },
              title: { type: "string", description: "Card title" },
              contents: { type: "string", description: "Card contents in markdown" },
              referencedFiles: {
                type: "array",
                items: { type: "string" },
                description: "File paths referenced by this card",
              },
            },
            required: ["group", "title", "contents"],
          },
          handler: async (input: {
            group: string;
            title: string;
            contents: string;
            referencedFiles?: string[];
          }) => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
            }
            // Normalize group: lowercase, replace non-alphanumeric with hyphens, max 50 chars
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

            return {
              text: JSON.stringify({ created: !existing, cardId: card.id }),
            };
          },
        }),

        tool({
          name: "anki_invalidate",
          description:
            "Mark an Anki card as stale/outdated with a reason. Use when you know a card's contents are no longer accurate.",
          inputSchema: {
            type: "object" as const,
            properties: {
              group: { type: "string", description: "Card group name" },
              title: { type: "string", description: "Card title" },
              reason: {
                type: "string",
                description: "Reason why the card is now stale/outdated",
              },
            },
            required: ["group", "title", "reason"],
          },
          handler: async (input: { group: string; title: string; reason: string }) => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
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
              return { text: JSON.stringify({ success: true }) };
            } catch (err: any) {
              if (err.code === "P2025") {
                return {
                  text: JSON.stringify({ success: false, error: "Card not found" }),
                };
              }
              throw err;
            }
          },
        }),

        tool({
          name: "anki_delete",
          description: "Permanently delete an Anki card from the current project.",
          inputSchema: {
            type: "object" as const,
            properties: {
              group: { type: "string", description: "Card group name" },
              title: { type: "string", description: "Card title" },
            },
            required: ["group", "title"],
          },
          handler: async (input: { group: string; title: string }) => {
            if (!ctx.projectId) {
              return { text: "No project associated with this thread." };
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
              return { text: JSON.stringify({ success: true }) };
            } catch (err: any) {
              if (err.code === "P2025") {
                return { text: JSON.stringify({ success: false }) };
              }
              throw err;
            }
          },
        }),
      ],
    });
  } catch (err: any) {
    console.log(`[custom-tools] Failed to create MCP server: ${err.message}`);
    return undefined;
  }
}
