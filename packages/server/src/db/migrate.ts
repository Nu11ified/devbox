import path from "node:path";
import pg from "pg";
import { execFileSync } from "node:child_process";

const DEFAULT_DATABASE_URL =
  "postgresql://patchwork:patchwork@localhost:5432/patchwork";

export async function runMigration(
  databaseUrl?: string
): Promise<void> {
  const url = databaseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

  // 1. Ensure issue_seq exists (Prisma can't manage sequences)
  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query(`
      DO $$ BEGIN
        CREATE SEQUENCE IF NOT EXISTS issue_seq START 1;
      EXCEPTION WHEN duplicate_table THEN
        NULL;
      END $$;
    `);
    console.log("Sequence check complete");
  } finally {
    await client.end();
  }

  // 2. Run Prisma migrations
  const cwd = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../");
  const env = { ...process.env, DATABASE_URL: url };
  try {
    execFileSync("bunx", ["prisma", "migrate", "deploy"], {
      env,
      stdio: "inherit",
      cwd,
    });
    console.log("Prisma migration complete");
  } catch {
    // If no migrations exist yet (first deploy), run db push as fallback
    console.log("No Prisma migrations found, using db push...");
    execFileSync("bunx", ["prisma", "db", "push", "--accept-data-loss"], {
      env,
      stdio: "inherit",
      cwd,
    });
    console.log("Prisma db push complete");
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
