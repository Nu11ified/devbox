import prisma from "./prisma.js";
import { CredentialStore } from "../auth/credential-store.js";

/**
 * One-time migration: move UserSettings.anthropicApiKey values into
 * the new ProviderCredential table (encrypted with per-user keys).
 *
 * Safe to run multiple times (uses upsert internally).
 */
export async function migrateCredentials(): Promise<{ migrated: number; skipped: number }> {
  const encKeyHex = process.env.PATCHWORK_ENCRYPTION_KEY;
  if (!encKeyHex) {
    throw new Error(
      "Cannot migrate credentials without PATCHWORK_ENCRYPTION_KEY. " +
      "Set this env var to a 64-character hex string (32 bytes) before running migration."
    );
  }

  const masterKey = Buffer.from(encKeyHex, "hex");
  const store = new CredentialStore(masterKey);

  const settingsWithKeys = await prisma.userSettings.findMany({
    where: {
      anthropicApiKey: { not: null },
    },
    select: {
      userId: true,
      anthropicApiKey: true,
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const settings of settingsWithKeys) {
    if (!settings.anthropicApiKey) {
      skipped++;
      continue;
    }

    try {
      await store.storeApiKey(settings.userId, "claude", settings.anthropicApiKey);
      migrated++;
      console.log(`[migrate] Migrated API key for user ${settings.userId}`);
    } catch (err: any) {
      console.error(`[migrate] Failed for user ${settings.userId}:`, err.message);
      skipped++;
    }
  }

  return { migrated, skipped };
}

// CLI entry point
const _isMain = process.argv[1] && (process.argv[1].endsWith("/migrate-credentials.ts") || process.argv[1].endsWith("/migrate-credentials.js"));
if (_isMain) {
  migrateCredentials()
    .then(({ migrated, skipped }) => {
      console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err.message);
      process.exit(1);
    });
}
