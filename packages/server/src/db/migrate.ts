import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const DEFAULT_DATABASE_URL =
  "postgresql://patchwork:patchwork@localhost:5432/patchwork";

export async function runMigration(
  databaseUrl?: string
): Promise<void> {
  const url = databaseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const client = new pg.Client({ connectionString: url });

  try {
    await client.connect();

    const schemaPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "schema.sql"
    );
    const sql = fs.readFileSync(schemaPath, "utf-8");

    await client.query(sql);
    console.log("Migration complete");
  } finally {
    await client.end();
  }
}

// Run directly via: npx tsx src/db/migrate.ts
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/migrate.ts") ||
    process.argv[1].endsWith("/migrate.js"));

if (isMain) {
  runMigration().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
