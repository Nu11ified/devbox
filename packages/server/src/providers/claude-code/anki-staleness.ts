import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import prisma from "../../db/prisma.js";

const STALE_CLEANUP_DAYS = 7;

/**
 * Run staleness detection and auto-cleanup for Anki cards in a project.
 * Called at the start of each agent session (not every turn).
 *
 * 1. Auto-delete cards that have been stale for > 7 days
 * 2. Check if any referenced files changed since lastVerifiedAt (batched git log)
 * 3. Mark affected cards as stale
 */
export async function runAnkiStalenessCheck(
  projectId: string,
  workspacePath: string
): Promise<void> {
  try {
    // --- Phase 1: Auto-cleanup stale cards older than threshold ---
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_CLEANUP_DAYS);

    await prisma.ankiCard.deleteMany({
      where: {
        projectId,
        stale: true,
        updatedAt: { lt: cutoff },
      },
    });

    // --- Phase 2: Staleness detection via batched git log ---
    // Skip if workspace doesn't exist or isn't a git repo
    if (!existsSync(workspacePath) || !existsSync(`${workspacePath}/.git`)) {
      return;
    }

    // Find all non-stale cards with referenced files
    const cards = await prisma.ankiCard.findMany({
      where: {
        projectId,
        stale: false,
        NOT: { referencedFiles: { equals: [] } },
      },
      select: {
        id: true,
        referencedFiles: true,
        lastVerifiedAt: true,
      },
    });

    if (cards.length === 0) return;

    // Find the oldest lastVerifiedAt
    const oldest = cards.reduce(
      (min, c) => (c.lastVerifiedAt < min ? c.lastVerifiedAt : min),
      cards[0].lastVerifiedAt
    );

    // Single git log to find all files changed since oldest timestamp
    let changedFiles: Set<string>;
    try {
      const output = execFileSync(
        "git",
        ["log", `--since=${oldest.toISOString()}`, "--name-only", "--pretty=format:"],
        { cwd: workspacePath, encoding: "utf-8", timeout: 10_000 }
      );
      changedFiles = new Set(
        output
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      );
    } catch {
      // git command failed — skip staleness check
      return;
    }

    if (changedFiles.size === 0) return;

    // Check each card's referenced files against the changed set
    for (const card of cards) {
      const staleFile = card.referencedFiles.find((f) => changedFiles.has(f));
      if (staleFile) {
        await prisma.ankiCard.update({
          where: { id: card.id },
          data: {
            stale: true,
            staleReason: `Referenced file ${staleFile} changed since last verified`,
          },
        });
      }
    }
  } catch (err: any) {
    // Non-fatal — don't block thread creation
    console.log(`[anki-staleness] Check failed: ${err.message}`);
  }
}
