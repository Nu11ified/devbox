import prisma from "../db/prisma.js";
import { Prisma } from "@prisma/client";

// Common words to strip from search terms
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "don", "now", "and", "but", "or", "if", "it", "its", "this", "that",
  "add", "fix", "update", "change", "make", "implement", "create",
]);

const MAX_CONTEXT_CHARS = 8000;

/**
 * Extract meaningful search terms from issue text.
 * Keeps file paths, component names, error patterns, and technical terms.
 */
function extractSearchTerms(text: string): string | null {
  const words = text
    .replace(/[^\w\s/.\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 15); // Cap to avoid overly broad queries

  return words.length > 0 ? words.join(" ") : null;
}

/**
 * Search archived thread turns for context relevant to a new issue.
 * Returns a formatted "Relevant Past Work" section, or null if nothing found.
 */
export async function findRelevantContext(
  issueTitle: string,
  issueBody: string,
  projectId?: string | null
): Promise<string | null> {
  const searchTerms = extractSearchTerms(issueTitle + " " + issueBody);
  if (!searchTerms) return null;

  try {
    const results = await prisma.$queryRaw<Array<{
      identifier: string;
      issue_title: string;
      snippet: string;
      rank: number;
    }>>`
      SELECT
        i.identifier,
        i.title as issue_title,
        ts_headline('english', COALESCE(t.content, ''),
          plainto_tsquery('english', ${searchTerms}),
          'MaxWords=50, MinWords=20') as snippet,
        ts_rank(to_tsvector('english', COALESCE(t.content, '')),
          plainto_tsquery('english', ${searchTerms})) as rank
      FROM thread_turns t
      JOIN threads th ON th.id = t.thread_id
      JOIN issues i ON i.id = th.issue_id
      WHERE i.status = 'archived'
        AND t.role = 'assistant'
        AND to_tsvector('english', COALESCE(t.content, ''))
          @@ plainto_tsquery('english', ${searchTerms})
        ${projectId ? Prisma.sql`AND i.project_id = ${projectId}::uuid` : Prisma.empty}
      ORDER BY rank DESC
      LIMIT 3
    `;

    if (!results.length) return null;

    let context = "## Relevant Past Work\n\n";
    context += "The following snippets from past completed issues may be relevant. Use only if helpful.\n\n";
    for (const r of results) {
      context += `### ${r.identifier}: ${r.issue_title}\n${r.snippet}\n\n`;
    }

    return context.length > MAX_CONTEXT_CHARS
      ? context.slice(0, MAX_CONTEXT_CHARS) + "\n..."
      : context;
  } catch (err) {
    console.error("[context-search] error:", err);
    return null;
  }
}
