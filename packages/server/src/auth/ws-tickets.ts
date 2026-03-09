import { randomBytes } from "node:crypto";

interface WsTicket {
  userId: string;
  expiresAt: number;
}

const tickets = new Map<string, WsTicket>();

const TICKET_TTL_MS = 30_000; // 30 seconds

/** Issue a short-lived ticket for the authenticated user. */
export function issueWsTicket(userId: string): string {
  const token = randomBytes(32).toString("hex");
  tickets.set(token, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
  return token;
}

/**
 * Validate and consume a ticket. Returns the userId if valid, null otherwise.
 * Each ticket can only be used once.
 */
export function consumeWsTicket(token: string): string | null {
  const ticket = tickets.get(token);
  if (!ticket) return null;
  tickets.delete(token);
  if (Date.now() > ticket.expiresAt) return null;
  return ticket.userId;
}

// Periodic cleanup of expired tickets
setInterval(() => {
  const now = Date.now();
  for (const [token, ticket] of tickets) {
    if (now > ticket.expiresAt) tickets.delete(token);
  }
}, 60_000);
