import pg from "pg";
import prisma from "./prisma.js";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://patchwork:patchwork@localhost:5433/patchwork";

function parseDbConfig(dbUrl: string): pg.PoolConfig {
  try {
    new URL(dbUrl);
    return { connectionString: dbUrl };
  } catch {
    const match = dbUrl.match(
      /^postgresql:\/\/([^:]+):(.+)@([^:\/]+):?(\d+)?\/(.+)$/
    );
    if (match) {
      return {
        user: match[1],
        password: match[2],
        host: match[3],
        port: match[4] ? parseInt(match[4], 10) : 5432,
        database: match[5],
      };
    }
    return { connectionString: dbUrl };
  }
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool(parseDbConfig(DATABASE_URL));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  await prisma.$disconnect();
}

// --- devbox_templates ---

export interface CreateTemplateInput {
  name: string;
  baseImage: string;
  resourceLimits: Record<string, unknown>;
  toolBundles?: string[];
  envVars?: Record<string, string>;
  bootstrap?: string[];
  networkPolicy?: string;
  repos?: string[];
}

export async function insertTemplate(input: CreateTemplateInput) {
  return prisma.devboxTemplate.create({
    data: {
      name: input.name,
      baseImage: input.baseImage,
      resourceLimits: input.resourceLimits as any,
      toolBundles: (input.toolBundles || []) as any,
      envVars: (input.envVars || {}) as any,
      bootstrap: (input.bootstrap || []) as any,
      networkPolicy: input.networkPolicy || "restricted",
      repos: (input.repos || []) as any,
    },
  });
}

export async function findAllTemplates() {
  return prisma.devboxTemplate.findMany({
    orderBy: { createdAt: "desc" },
  });
}

export async function findTemplateById(id: string) {
  return prisma.devboxTemplate.findUnique({ where: { id } });
}

export async function updateTemplate(
  id: string,
  fields: Partial<CreateTemplateInput>
) {
  const data: Record<string, unknown> = {};

  if (fields.name !== undefined) data.name = fields.name;
  if (fields.baseImage !== undefined) data.baseImage = fields.baseImage;
  if (fields.resourceLimits !== undefined) data.resourceLimits = fields.resourceLimits;
  if (fields.toolBundles !== undefined) data.toolBundles = fields.toolBundles;
  if (fields.envVars !== undefined) data.envVars = fields.envVars;
  if (fields.bootstrap !== undefined) data.bootstrap = fields.bootstrap;
  if (fields.networkPolicy !== undefined) data.networkPolicy = fields.networkPolicy;
  if (fields.repos !== undefined) data.repos = fields.repos;

  if (Object.keys(data).length === 0) {
    return findTemplateById(id);
  }

  try {
    return await prisma.devboxTemplate.update({
      where: { id },
      data,
    });
  } catch (err: unknown) {
    if ((err as any).code === "P2025") return null;
    throw err;
  }
}

export async function removeTemplate(id: string): Promise<boolean> {
  try {
    await prisma.devboxTemplate.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// --- issues ---

export interface CreateIssueInput {
  title: string;
  body?: string;
  repo: string;
  branch?: string;
  priority?: number;
  blueprintId?: string;
  templateId?: string;
  assignee?: string;
  labels?: string[];
  githubIssueId?: number;
  githubIssueUrl?: string;
  createdByUserId?: string;
  projectId?: string;
}

export async function nextIssueIdentifier(): Promise<string> {
  const result = await prisma.$queryRaw<[{ n: bigint }]>`SELECT nextval('issue_seq') AS n`;
  return `PW-${result[0].n}`;
}

export async function insertIssue(input: CreateIssueInput) {
  const identifier = await nextIssueIdentifier();
  return prisma.issue.create({
    data: {
      identifier,
      title: input.title,
      body: input.body || "",
      repo: input.repo,
      branch: input.branch || "main",
      priority: input.priority ?? 2,
      blueprintId: input.blueprintId || "simple",
      templateId: input.templateId || null,
      assignee: input.assignee || null,
      labels: input.labels || [],
      githubIssueId: input.githubIssueId ?? null,
      githubIssueUrl: input.githubIssueUrl ?? null,
      createdByUserId: input.createdByUserId ?? null,
      projectId: input.projectId ?? null,
    },
  });
}

export async function findAllIssues(filters?: {
  status?: string;
  repo?: string;
  priority?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.repo) where.repo = filters.repo;
  if (filters?.priority !== undefined) where.priority = filters.priority;

  return prisma.issue.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: {
      thread: {
        select: { id: true, status: true, worktreeBranch: true },
      },
    },
  });
}

export async function findIssueById(id: string) {
  return prisma.issue.findUnique({
    where: { id },
    include: {
      thread: {
        select: { id: true, status: true, worktreeBranch: true },
      },
    },
  });
}

export async function findIssueByIdentifier(identifier: string) {
  return prisma.issue.findUnique({ where: { identifier } });
}

export async function updateIssue(
  id: string,
  fields: Partial<CreateIssueInput & { status: string; runId: string; retryCount: number; lastError: string | null; prUrl: string | null }>
) {
  const data: Record<string, unknown> = {};

  const fieldMap: Record<string, string> = {
    title: "title",
    body: "body",
    repo: "repo",
    branch: "branch",
    priority: "priority",
    blueprintId: "blueprintId",
    templateId: "templateId",
    assignee: "assignee",
    labels: "labels",
    status: "status",
    runId: "runId",
    retryCount: "retryCount",
    lastError: "lastError",
    githubIssueId: "githubIssueId",
    githubIssueUrl: "githubIssueUrl",
    prUrl: "prUrl",
    createdByUserId: "createdByUserId",
    projectId: "projectId",
  };

  for (const [key, prismaKey] of Object.entries(fieldMap)) {
    if (key in fields) {
      data[prismaKey] = (fields as Record<string, unknown>)[key];
    }
  }

  if (Object.keys(data).length === 0) {
    return findIssueById(id);
  }

  try {
    return await prisma.issue.update({
      where: { id },
      data,
    });
  } catch (err: unknown) {
    if ((err as any).code === "P2025") return null;
    throw err;
  }
}

export async function removeIssue(id: string): Promise<boolean> {
  try {
    await prisma.issue.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function findDispatchableIssues() {
  return prisma.issue.findMany({
    where: { status: "queued" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}
