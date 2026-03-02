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
