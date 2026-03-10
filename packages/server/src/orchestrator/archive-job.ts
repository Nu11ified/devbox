import prisma from "../db/prisma.js";

const ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Archive issues that have been done or cancelled for more than 24 hours.
 * Returns the count of archived issues.
 */
export async function archiveStaleIssues(): Promise<number> {
  const cutoff = new Date(Date.now() - ARCHIVE_DELAY_MS);
  const result = await prisma.issue.updateMany({
    where: {
      status: { in: ["done", "cancelled"] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "archived",
      archivedAt: new Date(),
    },
  });
  return result.count;
}

/**
 * Starts the archive job on a 30-minute interval.
 * Returns a cleanup function to stop the interval.
 */
export function startArchiveJob(): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;

  async function run() {
    try {
      const count = await archiveStaleIssues();
      if (count > 0) {
        console.log(`[archive-job] archived ${count} stale issues`);
      }
    } catch (err) {
      console.error("[archive-job] error:", err);
    }
  }

  // Run immediately on start, then every 30 minutes
  run();
  timer = setInterval(run, ARCHIVE_INTERVAL_MS);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log("[archive-job] stopped");
    },
  };
}
