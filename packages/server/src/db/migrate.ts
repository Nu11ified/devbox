import path from "node:path";
import pg from "pg";
import { execFileSync } from "node:child_process";

const DEFAULT_DATABASE_URL =
  "postgresql://patchwork:patchwork@localhost:5432/patchwork";

export async function runMigration(
  databaseUrl?: string
): Promise<void> {
  const url = databaseUrl || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;

  // Build connection config — use individual params to avoid URL-encoding issues
  // when passwords contain special characters like + or /
  function parseDbConfig(dbUrl: string): pg.ClientConfig {
    try {
      new URL(dbUrl);
      return { connectionString: dbUrl };
    } catch {
      // URL parsing failed (special chars in password) — extract parts manually
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

  // 1. Ensure issue_seq exists (Prisma can't manage sequences)
  const client = new pg.Client(parseDbConfig(url));
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
    console.log("Prisma migrate deploy failed or no migrations found");
  }

  // Always run db push to ensure schema is in sync (handles fresh DBs
  // where migrate deploy exits 0 with "no pending migrations")
  execFileSync("bunx", ["prisma", "db", "push", "--accept-data-loss"], {
    env,
    stdio: "inherit",
    cwd,
  });
  console.log("Prisma db push complete");
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
