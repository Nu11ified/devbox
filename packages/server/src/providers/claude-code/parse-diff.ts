import type { DiffFile } from "../events.js";

export function parseDiff(rawDiff: string): DiffFile[] {
  if (!rawDiff.trim()) return [];

  const fileSections = rawDiff.split(/^diff --git /m).filter(Boolean);
  const files: DiffFile[] = [];

  for (const section of fileSections) {
    const lines = section.split("\n");

    // Extract file path from "a/path b/path" header
    const headerMatch = lines[0]?.match(/^a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const filePath = headerMatch[2];

    // Skip binary files
    if (section.includes("Binary files")) continue;

    // Determine status from ---/+++ lines
    let status: DiffFile["status"] = "modified";
    const minusLine = lines.find((l) => l.startsWith("--- "));
    const plusLine = lines.find((l) => l.startsWith("+++ "));
    if (minusLine === "--- /dev/null") {
      status = "added";
    } else if (plusLine === "+++ /dev/null") {
      status = "deleted";
    }

    // Parse hunks
    const hunks: DiffFile["hunks"] = [];
    let currentHunk: DiffFile["hunks"][number] | null = null;

    for (const line of lines) {
      if (line.startsWith("@@ ")) {
        currentHunk = { header: line, lines: [] };
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      // Skip metadata lines
      if (
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("diff --git ")
      )
        continue;

      if (line.startsWith("+")) {
        currentHunk.lines.push({ type: "add", content: line.slice(1) });
      } else if (line.startsWith("-")) {
        currentHunk.lines.push({ type: "remove", content: line.slice(1) });
      } else if (line.startsWith(" ")) {
        currentHunk.lines.push({ type: "context", content: line.slice(1) });
      } else if (line === "" && currentHunk.lines.length > 0) {
        // Empty line inside a hunk (git sometimes omits the leading space)
        // But skip if this is the last line (trailing newline artifact)
        const remaining = lines.slice(lines.indexOf(line) + 1);
        const hasMoreContent = remaining.some((l) =>
          l.startsWith("+") || l.startsWith("-") || l.startsWith(" ") || l.startsWith("@@ ")
        );
        if (hasMoreContent) {
          currentHunk.lines.push({ type: "context", content: "" });
        }
      }
    }

    files.push({ path: filePath, status, hunks });
  }

  return files;
}
