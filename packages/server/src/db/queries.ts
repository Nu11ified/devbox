import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://patchwork:patchwork@localhost:5433/patchwork";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
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
  const db = getPool();
  const result = await db.query(
    `INSERT INTO devbox_templates (name, base_image, resource_limits, tool_bundles, env_vars, bootstrap, network_policy, repos)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.name,
      input.baseImage,
      JSON.stringify(input.resourceLimits),
      JSON.stringify(input.toolBundles || []),
      JSON.stringify(input.envVars || {}),
      JSON.stringify(input.bootstrap || []),
      input.networkPolicy || "restricted",
      JSON.stringify(input.repos || []),
    ]
  );
  return result.rows[0];
}

export async function findAllTemplates() {
  const db = getPool();
  const result = await db.query(
    "SELECT * FROM devbox_templates ORDER BY created_at DESC"
  );
  return result.rows;
}

export async function findTemplateById(id: string) {
  const db = getPool();
  const result = await db.query(
    "SELECT * FROM devbox_templates WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

export async function updateTemplate(
  id: string,
  fields: Partial<CreateTemplateInput>
) {
  const db = getPool();

  // Build SET clause dynamically from provided fields
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const columnMap: Record<string, string> = {
    name: "name",
    baseImage: "base_image",
    resourceLimits: "resource_limits",
    toolBundles: "tool_bundles",
    envVars: "env_vars",
    bootstrap: "bootstrap",
    networkPolicy: "network_policy",
    repos: "repos",
  };

  const jsonFields = new Set([
    "resourceLimits",
    "toolBundles",
    "envVars",
    "bootstrap",
    "repos",
  ]);

  for (const [key, col] of Object.entries(columnMap)) {
    if (key in fields) {
      setClauses.push(`${col} = $${idx}`);
      const val = (fields as Record<string, unknown>)[key];
      values.push(jsonFields.has(key) ? JSON.stringify(val) : val);
      idx++;
    }
  }

  if (setClauses.length === 0) {
    return findTemplateById(id);
  }

  setClauses.push(`updated_at = now()`);
  values.push(id);

  const result = await db.query(
    `UPDATE devbox_templates SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function removeTemplate(id: string): Promise<boolean> {
  const db = getPool();
  const result = await db.query(
    "DELETE FROM devbox_templates WHERE id = $1 RETURNING id",
    [id]
  );
  return result.rowCount !== null && result.rowCount > 0;
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
}

export async function nextIssueIdentifier(): Promise<string> {
  const db = getPool();
  const result = await db.query("SELECT nextval('issue_seq') AS n");
  return `PW-${result.rows[0].n}`;
}

export async function insertIssue(input: CreateIssueInput) {
  const db = getPool();
  const identifier = await nextIssueIdentifier();
  const result = await db.query(
    `INSERT INTO issues (identifier, title, body, repo, branch, priority, blueprint_id, template_id, assignee, labels)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      identifier,
      input.title,
      input.body || "",
      input.repo,
      input.branch || "main",
      input.priority ?? 2,
      input.blueprintId || "simple",
      input.templateId || null,
      input.assignee || null,
      JSON.stringify(input.labels || []),
    ]
  );
  return result.rows[0];
}

export async function findAllIssues(filters?: {
  status?: string;
  repo?: string;
  priority?: number;
}) {
  const db = getPool();
  let sql = "SELECT * FROM issues";
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters?.status) {
    conditions.push(`status = $${idx++}`);
    params.push(filters.status);
  }
  if (filters?.repo) {
    conditions.push(`repo = $${idx++}`);
    params.push(filters.repo);
  }
  if (filters?.priority !== undefined) {
    conditions.push(`priority = $${idx++}`);
    params.push(filters.priority);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY priority ASC, created_at ASC";

  const result = await db.query(sql, params);
  return result.rows;
}

export async function findIssueById(id: string) {
  const db = getPool();
  const result = await db.query("SELECT * FROM issues WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function findIssueByIdentifier(identifier: string) {
  const db = getPool();
  const result = await db.query(
    "SELECT * FROM issues WHERE identifier = $1",
    [identifier]
  );
  return result.rows[0] || null;
}

export async function updateIssue(
  id: string,
  fields: Partial<CreateIssueInput & { status: string; runId: string; retryCount: number; lastError: string | null }>
) {
  const db = getPool();

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const columnMap: Record<string, string> = {
    title: "title",
    body: "body",
    repo: "repo",
    branch: "branch",
    priority: "priority",
    blueprintId: "blueprint_id",
    templateId: "template_id",
    assignee: "assignee",
    labels: "labels",
    status: "status",
    runId: "run_id",
    retryCount: "retry_count",
    lastError: "last_error",
  };

  const jsonFields = new Set(["labels"]);

  for (const [key, col] of Object.entries(columnMap)) {
    if (key in fields) {
      setClauses.push(`${col} = $${idx}`);
      const val = (fields as Record<string, unknown>)[key];
      values.push(jsonFields.has(key) ? JSON.stringify(val) : val);
      idx++;
    }
  }

  if (setClauses.length === 0) {
    return findIssueById(id);
  }

  setClauses.push(`updated_at = now()`);
  values.push(id);

  const result = await db.query(
    `UPDATE issues SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

export async function removeIssue(id: string): Promise<boolean> {
  const db = getPool();
  const result = await db.query(
    "DELETE FROM issues WHERE id = $1 RETURNING id",
    [id]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

export async function findDispatchableIssues() {
  const db = getPool();
  const result = await db.query(
    "SELECT * FROM issues WHERE status = 'queued' ORDER BY priority ASC, created_at ASC"
  );
  return result.rows;
}
