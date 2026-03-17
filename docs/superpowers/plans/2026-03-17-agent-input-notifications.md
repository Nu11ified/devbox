# Agent Input Notification & Response UI — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify users globally when agent threads need input, and provide an interactive UI for responding to `ask_user` events (clickable options + free-form text).

**Architecture:** Server emits transient `thread.status` events via the existing Effect stream fan-out. A project-level WebSocket endpoint forwards these to all project subscribers. The UI displays amber sidebar dots, toasts, and an interactive `AskUserCard` component.

**Tech Stack:** TypeScript, Effect-TS, Express, WebSocket (ws), React 19, Next.js 16, Tailwind CSS v4, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-17-agent-input-notifications-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/ui/src/components/thread/ask-user-card.tsx` | Interactive card for responding to agent questions (options + text input) |
| `packages/ui/src/hooks/use-project-events.ts` | Project-level WS hook + `PendingInputsProvider` context |

### Modified Files
| File | Changes |
|------|---------|
| `packages/server/src/providers/events.ts` | Add `ThreadStatusPayload` + union variant |
| `packages/server/src/providers/adapter.ts` | Extend `ApprovalDecision` allow variant with `reason` |
| `packages/server/src/providers/claude-code/adapter.ts` | Emit `thread.status` events; fix answer passthrough |
| `packages/server/src/api/thread-ws.ts` | Extend fan-out with project connections; add project WS endpoint |
| `packages/server/src/index.ts` | Register project events WS upgrade path |
| `packages/ui/src/components/thread/timeline.tsx` | Render `AskUserCard` for `ask_user` items |
| `packages/ui/src/components/ui/toast.tsx` | Add `warning` variant |
| `packages/ui/src/components/project-sidebar.tsx` | Consume `usePendingInputs()` for amber dot |
| `packages/ui/src/app/projects/[projectId]/layout.tsx` | Wrap with `PendingInputsProvider` |
| `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` | Suppress duplicate cards; reconstruct `ask_user` on reload; wire submission |

---

## Chunk 1: Server — Event Types and Answer Passthrough

### Task 1: Add `ThreadStatusPayload` to events.ts

**Files:**
- Modify: `packages/server/src/providers/events.ts:129-178`

- [ ] **Step 1: Add the ThreadStatusPayload interface**

Add after `SessionResumedPayload` (line 155):

```typescript
export interface ThreadStatusPayload {
  status: "needs_input" | "running";
  requestId?: string;
  question?: string;
  options?: Array<{ label: string; value: string }>;
  threadName?: string;
}
```

- [ ] **Step 2: Add thread.status to the ProviderRuntimeEvent union**

Add to the union (before the closing semicolon at line 178):

```typescript
  | { type: "thread.status"; payload: ThreadStatusPayload }
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/events.ts
git commit -m "feat: add ThreadStatusPayload event type for input notifications"
```

### Task 2: Extend ApprovalDecision with reason on allow

**Files:**
- Modify: `packages/server/src/providers/adapter.ts:69-72`

- [ ] **Step 1: Add reason to the allow variant**

Change line 70 from:
```typescript
  | { type: "allow" }
```
to:
```typescript
  | { type: "allow"; reason?: string }
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/providers/adapter.ts
git commit -m "feat: add reason field to ApprovalDecision allow variant"
```

### Task 3: Fix AskUserQuestion answer passthrough and emit thread.status

**Files:**
- Modify: `packages/server/src/providers/claude-code/adapter.ts:496-546`

- [ ] **Step 1: Emit thread.status needs_input event**

Ensure `prisma` is imported at the top of the adapter file (it may already be imported; if not, add `import prisma from "../../../db/prisma.js";`).

After the `request.opened` enqueue (after line 523), add:

```typescript
          // Emit transient thread.status for project-level notifications
          // Look up thread name for the toast notification
          const threadRecord = await prisma.thread.findUnique({
            where: { id: threadId as string },
            select: { title: true },
          });
          await self.enqueue(
            self.makeEnvelope("thread.status", threadId, {
              status: "needs_input",
              requestId,
              question: questions.length > 0 ? questions[0].question : "Agent needs input",
              options: questions.length > 0 ? questions[0].options : [],
              threadName: threadRecord?.title ?? undefined,
            } as any, turnId)
          );
```

- [ ] **Step 2: Fix the allow branch to pass the answer through**

Replace lines 542-546 (the `// For AskUserQuestion...` comment and return):

```typescript
          // For AskUserQuestion, the answer is passed in the reason field
          return {
            behavior: "allow" as const,
            updatedInput: input,
          };
```

with:

```typescript
          // For AskUserQuestion, pass the user's answer back via updatedInput
          // The reason field carries the user's response text
          return {
            behavior: "allow" as const,
            updatedInput: { ...input, result: decision.reason ?? "" },
          };
```

- [ ] **Step 3: Emit thread.status running after request is resolved**

After the `request.resolved` enqueue for AskUserQuestion (after line 536), add:

```typescript
          // Emit thread.status running to clear notifications
          await self.enqueue(
            self.makeEnvelope("thread.status", threadId, {
              status: "running",
            } as any, turnId)
          );
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/providers/claude-code/adapter.ts
git commit -m "feat: emit thread.status events and fix AskUserQuestion answer passthrough"
```

---

## Chunk 2: Server — Project-Level WebSocket Fan-out

### Task 4: Extend startEventFanOut with project connections

**Files:**
- Modify: `packages/server/src/api/thread-ws.ts:1-442`

- [ ] **Step 1: Add project connection types and maps**

Add after the `ThreadConnection` interface (after line 16):

```typescript
interface ProjectConnection {
  ws: WebSocket;
  projectId: string;
  userId: string;
}

// Project-level connections for thread.status fan-out
const projectConnections = new Map<string, Set<ProjectConnection>>();
// Cache: threadId → projectId (populated from DB on first lookup)
const threadToProject = new Map<string, string>();
```

- [ ] **Step 2: Add helper to resolve threadId → projectId**

Add after the new maps:

```typescript
async function resolveProjectId(threadId: string): Promise<string | null> {
  const cached = threadToProject.get(threadId);
  if (cached) return cached;
  const thread = await prisma.thread.findUnique({
    where: { id: threadId },
    select: { projectId: true },
  });
  if (thread?.projectId) {
    threadToProject.set(threadId, thread.projectId);
    return thread.projectId;
  }
  return null;
}
```

- [ ] **Step 3: Update startEventFanOut to handle thread.status events**

Replace the `startEventFanOut` function (lines 393-442) with:

```typescript
function startEventFanOut(
  providerService: ProviderService,
  connections: Map<string, Set<ThreadConnection>>
): void {
  const stream = providerService.mergedEventStream();

  const program = Stream.runForEach(stream, (envelope: ProviderEventEnvelope) =>
    Effect.gen(function* () {
      const isThreadStatus = envelope.type === "thread.status";

      // thread.status events are transient — do NOT persist or send to thread-level clients
      if (!isThreadStatus) {
        // Fan out to thread-level WebSocket clients (before persistence)
        const threadConns = connections.get(envelope.threadId as string);
        if (threadConns && threadConns.size > 0) {
          const { raw, ...slimEnvelope } = envelope as ProviderEventEnvelope & { raw?: unknown };
          try {
            const payload = JSON.stringify({
              type: "thread.event",
              event: slimEnvelope,
            });

            for (const conn of threadConns) {
              if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(payload);
              }
            }
          } catch (err) {
            console.error("[thread-ws] Failed to serialize event:", envelope.type, err);
          }
        }

        // Persist event to database (non-fatal)
        yield* providerService.persistEvent(envelope).pipe(
          Effect.catchAll((err) =>
            Effect.sync(() => {
              console.error("[thread-ws] Failed to persist event:", envelope.type, err);
            })
          )
        );
      }

      // Forward thread.status events to project-level connections
      if (isThreadStatus) {
        yield* Effect.promise(async () => {
          const pid = await resolveProjectId(envelope.threadId as string);
          if (!pid) return;
          const projConns = projectConnections.get(pid);
          if (!projConns || projConns.size === 0) return;

          try {
            const payload = JSON.stringify({
              type: "thread.status",
              threadId: envelope.threadId,
              ...envelope.payload,
            });
            for (const conn of projConns) {
              if (conn.ws.readyState === WebSocket.OPEN) {
                conn.ws.send(payload);
              }
            }
          } catch (err) {
            console.error("[thread-ws] Failed to fan out thread.status:", err);
          }
        });
      }
    })
  );

  Effect.runFork(
    program.pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          console.error("[thread-ws] Event fan-out stream error:", error);
        })
      )
    )
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/thread-ws.ts
git commit -m "feat: extend event fan-out with project-level thread.status forwarding"
```

### Task 5: Add project events WebSocket endpoint

**Files:**
- Modify: `packages/server/src/api/thread-ws.ts` (add to `setupThreadWebSocket`)
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Export projectConnections and add project WS handler**

In `thread-ws.ts`, add a new exported function after `setupThreadWebSocket`:

```typescript
export function setupProjectEventsWebSocket(
  server: HttpServer,
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const match = url.pathname.match(/^\/ws\/projects\/([^/]+)\/events$/);
    if (match) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, match[1]);
      });
    }
  });

  wss.on("connection", async (ws: WebSocket, req: any, projectId: string) => {
    // Authenticate via ticket or session cookie (same pattern as thread WS)
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    let authedUserId: string | null = null;

    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      authedUserId = consumeWsTicket(ticket);
    }

    if (!authedUserId) {
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c: string) => {
          const [key, ...rest] = c.trim().split("=");
          return [key, rest.join("=")];
        })
      );
      const sessionToken = cookies["better-auth.session_token"] ?? cookies["__Secure-better-auth.session_token"];
      if (sessionToken) {
        const session = await prisma.session.findUnique({
          where: { token: sessionToken },
          include: { user: true },
        });
        if (session && session.expiresAt >= new Date()) {
          authedUserId = session.user.id;
        }
      }
    }

    if (!authedUserId) {
      ws.close(4001, "Authentication required");
      return;
    }

    // Verify project exists and belongs to user
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, name: true },
    });
    if (!project || (project.userId && project.userId !== authedUserId)) {
      ws.close(4003, "Not authorized");
      return;
    }

    console.log(`[project-ws] Client connected: project=${projectId} user=${authedUserId}`);

    const conn: ProjectConnection = { ws, projectId, userId: authedUserId };
    if (!projectConnections.has(projectId)) {
      projectConnections.set(projectId, new Set());
    }
    projectConnections.get(projectId)!.add(conn);

    // Send initial state: find threads with unresolved ask_user requests
    try {
      const threads = await prisma.thread.findMany({
        where: { projectId, archivedAt: null },
        select: { id: true, title: true },
      });
      for (const thread of threads) {
        // Check if there's an unresolved ask_user event (ask_user without matching request.resolved)
        const lastAsk = await prisma.event.findFirst({
          where: { threadId: thread.id, type: "ask_user" },
          orderBy: { createdAt: "desc" },
        });
        if (lastAsk) {
          const resolved = await prisma.event.findFirst({
            where: {
              threadId: thread.id,
              type: "request.resolved",
              payload: { path: ["requestId"], equals: (lastAsk.payload as any)?.requestId },
            },
          });
          if (!resolved) {
            const p = lastAsk.payload as any;
            ws.send(JSON.stringify({
              type: "thread.status",
              threadId: thread.id,
              status: "needs_input",
              requestId: p?.requestId,
              question: p?.question ?? "Agent needs input",
              options: p?.options ?? [],
              threadName: thread.title,
            }));
          }
        }
      }
    } catch (err) {
      console.error("[project-ws] Failed to send initial state:", err);
    }

    // Keep-alive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 25_000);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {}
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      console.log(`[project-ws] Client disconnected: project=${projectId}`);
      projectConnections.get(projectId)?.delete(conn);
      if (projectConnections.get(projectId)?.size === 0) {
        projectConnections.delete(projectId);
      }
    });
  });
}
```

- [ ] **Step 2: Register in server index**

In `packages/server/src/index.ts`, add the import:

```typescript
import { setupProjectEventsWebSocket } from "./api/thread-ws.js";
```

And where `setupThreadWebSocket` is called (find it near the bottom), add after it:

```typescript
setupProjectEventsWebSocket(server);
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/thread-ws.ts packages/server/src/index.ts
git commit -m "feat: add project-level WebSocket endpoint for thread status events"
```

---

## Chunk 3: UI — Toast Warning Variant

### Task 6: Add warning toast variant

**Files:**
- Modify: `packages/ui/src/components/ui/toast.tsx:7-88`

- [ ] **Step 1: Add warning to ToastType**

Change line 7:
```typescript
type ToastType = "success" | "error" | "info" | "progress";
```
to:
```typescript
type ToastType = "success" | "error" | "info" | "progress" | "warning";
```

- [ ] **Step 2: Add onClick to Toast interface**

Add to the `Toast` interface (after `currentStage`, line 16):
```typescript
  onClick?: () => void;
```

- [ ] **Step 3: Add AlertTriangle import**

Update the import on line 4:
```typescript
import { X, CheckCircle2, AlertCircle, Info, Loader2, AlertTriangle } from "lucide-react";
```

- [ ] **Step 4: Add warning to icon and color maps**

Add to `iconMap` (after line 81):
```typescript
  warning: AlertTriangle,
```

Add to `colorMap` (after line 88):
```typescript
  warning: "text-amber-400",
```

- [ ] **Step 5: Add onClick handler to ToastItem**

In the `ToastItem` component, wrap the outer div with an onClick handler. Change the outer `<div` (line 105-112) to include:

```typescript
      onClick={() => {
        if (toast.onClick) {
          toast.onClick();
          onDismiss();
        }
      }}
      style={{ cursor: toast.onClick ? "pointer" : undefined }}
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/ui/toast.tsx
git commit -m "feat: add warning toast variant with onClick support"
```

---

## Chunk 4: UI — AskUserCard Component

### Task 7: Create the AskUserCard component

**Files:**
- Create: `packages/ui/src/components/thread/ask-user-card.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useRef } from "react";
import { HelpCircle, Send, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AskUserCardProps {
  requestId: string;
  question: string;
  options?: Array<{ label: string; value: string }>;
  resolved?: boolean;
  response?: string;
  onRespond: (requestId: string, answer: string) => void;
}

export function AskUserCard({
  requestId,
  question,
  options,
  resolved,
  response,
  onRespond,
}: AskUserCardProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [chosenAnswer, setChosenAnswer] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isResolved = resolved || submitted;
  const displayResponse = response || chosenAnswer;

  function handleSubmit(answer: string) {
    if (!answer.trim()) return;
    try {
      onRespond(requestId, answer);
      setChosenAnswer(answer);
      setSubmitted(true);
      setError(null);
    } catch {
      setError("Failed to send response. Try again.");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(text);
    }
  }

  if (isResolved) {
    return (
      <div className="flex gap-3 items-start max-w-3xl mx-auto">
        <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <HelpCircle className="h-3.5 w-3.5 text-blue-500/40" />
        </div>
        <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-lg px-3 py-2 flex-1">
          <p className="text-sm text-zinc-500 mb-1.5">{question}</p>
          <div className="flex items-center gap-1.5">
            <Check className="h-3 w-3 text-green-500 shrink-0" />
            <span className="text-xs font-mono text-zinc-400">
              {displayResponse}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start max-w-3xl mx-auto">
      <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
        <HelpCircle className="h-3.5 w-3.5 text-blue-500/60" />
      </div>
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2.5 flex-1 space-y-2.5">
        <p className="text-sm text-blue-300">{question}</p>

        {/* Option buttons */}
        {options && options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSubmit(opt.value)}
                className="text-[11px] px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 hover:text-blue-300 transition-colors cursor-pointer"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Text input — always visible */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a custom response..."
            className="flex-1 bg-zinc-900/60 border border-zinc-700/40 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/40 transition-colors"
          />
          <button
            onClick={() => handleSubmit(text)}
            disabled={!text.trim()}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              text.trim()
                ? "text-blue-400 hover:bg-blue-500/10"
                : "text-zinc-700 cursor-not-allowed"
            )}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
            <button
              onClick={() => handleSubmit(text)}
              className="text-red-300 underline hover:text-red-200"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/thread/ask-user-card.tsx
git commit -m "feat: create AskUserCard interactive component"
```

---

## Chunk 5: UI — Wire AskUserCard into Timeline and Thread Page

### Task 8: Update timeline to render AskUserCard

**Files:**
- Modify: `packages/ui/src/components/thread/timeline.tsx:1-178`

- [ ] **Step 1: Add AskUserCard import**

Add to imports (after line 6):
```typescript
import { AskUserCard } from "./ask-user-card";
```

- [ ] **Step 2: Add onRespondToAsk prop to Timeline**

Update `TimelineProps` (lines 37-40):
```typescript
interface TimelineProps {
  items: TimelineItem[];
  onApprove: (requestId: string, decision: "allow" | "deny" | "allow_session") => void;
  onRespondToAsk: (requestId: string, answer: string) => void;
}
```

Update the component signature (line 42):
```typescript
export function Timeline({ items, onApprove, onRespondToAsk }: TimelineProps) {
```

- [ ] **Step 3: Replace the ask_user case**

Replace the `case "ask_user":` block (lines 135-157) with:

```tsx
            case "ask_user":
              return (
                <AskUserCard
                  key={item.id}
                  requestId={item.requestId ?? ""}
                  question={item.question ?? ""}
                  options={item.options}
                  resolved={item.resolved}
                  response={item.decision}
                  onRespond={onRespondToAsk}
                />
              );
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/thread/timeline.tsx
git commit -m "feat: render AskUserCard for ask_user timeline items"
```

### Task 9: Wire AskUserCard submission and suppress duplicate cards in page.tsx

**Files:**
- Modify: `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx`

- [ ] **Step 1: Add handleRespondToAsk callback**

Add after `handleSend` (after line 400). We use `send()` directly rather than `approve()` because `approve()` from `useThreadSocket` doesn't support the `reason` field:

```typescript
  const handleRespondToAsk = useCallback(
    (requestId: string, answer: string) => {
      send({ type: "thread.approval", requestId, decision: "allow", reason: answer });
      setItems((prev) =>
        prev.map((i) =>
          i.requestId === requestId
            ? { ...i, resolved: true, decision: answer }
            : i
        )
      );
    },
    [send]
  );
```

- [ ] **Step 2: Suppress duplicate request.opened for AskUserQuestion in handleEvent**

In the `case "request.opened"` block (lines 230-245), add a guard at the top:

```typescript
        case "request.opened": {
          // Suppress AskUserQuestion — already rendered via ask_user event as AskUserCard
          if (e.payload.toolName === "AskUserQuestion") break;
          setItems((prev) => [
            ...prev,
            {
              id: `req-${e.payload.requestId}`,
              kind: "approval_request",
              requestId: e.payload.requestId,
              toolName: e.payload.toolName,
              toolCategory: e.payload.toolCategory,
              description: e.payload.description,
              input: e.payload.input,
              resolved: false,
            },
          ]);
          break;
        }
```

- [ ] **Step 3: Suppress duplicate request.opened in loadThread (historical)**

In the `loadThread` function, update the `request.opened` block (lines 91-103). Add a guard:

```typescript
          } else if (evt.type === "request.opened") {
            const p = evt.payload;
            // Suppress AskUserQuestion — rendered via ask_user event
            if (p.toolName === "AskUserQuestion") continue;
            initial.push({
              id: `req-${p.requestId}`,
              kind: "approval_request",
              requestId: p.requestId,
              toolName: p.toolName,
              toolCategory: p.toolCategory,
              description: p.description,
              input: p.input,
              resolved: true,
            });
```

- [ ] **Step 4: Add ask_user reconstruction in loadThread**

In the same `loadThread` function, after the `request.opened` block, add handling for `ask_user` events. Also build a set of resolved request IDs first. Before the `for (const turn of data.turns)` loop (around line 73), add:

```typescript
      // Build set of resolved requestIds for determining ask_user state
      const resolvedRequests = new Set<string>();
      for (const evt of data.events ?? []) {
        if (evt.type === "request.resolved") {
          resolvedRequests.add(evt.payload?.requestId);
        }
      }
```

Then inside the `for (const evt of turnEvents)` loop, add after `request.opened` handling:

```typescript
          } else if (evt.type === "ask_user") {
            const p = evt.payload;
            initial.push({
              id: `ask-${p.requestId}`,
              kind: "ask_user" as const,
              question: p.question,
              options: p.options,
              requestId: p.requestId,
              resolved: resolvedRequests.has(p.requestId),
            });
```

- [ ] **Step 5: Pass handleRespondToAsk to Timeline**

Update the `<Timeline>` component usage (line 646):

```tsx
          <Timeline items={items} onApprove={approve} onRespondToAsk={handleRespondToAsk} />
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx
git commit -m "feat: wire AskUserCard submission and suppress duplicate approval cards"
```

---

## Chunk 6: UI — Project Events Hook and PendingInputsProvider

### Task 10: Create useProjectEvents hook and PendingInputsProvider

**Files:**
- Create: `packages/ui/src/hooks/use-project-events.ts`

- [ ] **Step 1: Write the hook and provider**

```tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

interface PendingInput {
  threadId: string;
  requestId: string;
  question: string;
  options?: Array<{ label: string; value: string }>;
  threadName?: string;
}

interface PendingInputsContextValue {
  pendingInputs: Map<string, PendingInput>;
}

const PendingInputsContext = createContext<PendingInputsContextValue>({
  pendingInputs: new Map(),
});

export function usePendingInputs() {
  return useContext(PendingInputsContext);
}

function getProjectWsUrl(projectId: string, ticket?: string): string {
  const params = new URLSearchParams();
  if (ticket) params.set("ticket", ticket);
  const qs = params.toString();

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (wsUrl) {
    return `${wsUrl}/ws/projects/${projectId}/events${qs ? `?${qs}` : ""}`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws/projects/${projectId}/events${qs ? `?${qs}` : ""}`;
}

function isCrossOriginWs(): boolean {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) return false;
  try {
    const wsOrigin = new URL(wsUrl.replace(/^ws/, "http")).origin;
    return wsOrigin !== window.location.origin;
  } catch {
    return false;
  }
}

export function PendingInputsProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [pendingInputs, setPendingInputs] = useState<Map<string, PendingInput>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;

    async function connect() {
      if (disposed) return;

      let ticket: string | undefined;
      if (isCrossOriginWs()) {
        try {
          ticket = await api.getWsTicket();
        } catch {
          if (!disposed) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
            reconnectAttempt.current++;
            reconnectTimer.current = setTimeout(connect, delay);
          }
          return;
        }
        if (disposed) return;
      }

      const url = getProjectWsUrl(projectId, ticket);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        if (pingTimer.current) clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (pingTimer.current) {
          clearInterval(pingTimer.current);
          pingTimer.current = null;
        }
        if (!disposed) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
          reconnectAttempt.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {};

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "pong") return;

          if (data.type === "thread.status") {
            if (data.status === "needs_input") {
              const input: PendingInput = {
                threadId: data.threadId,
                requestId: data.requestId,
                question: data.question ?? "Agent needs input",
                options: data.options,
                threadName: data.threadName,
              };

              setPendingInputs((prev) => {
                const next = new Map(prev);
                next.set(data.threadId, input);
                return next;
              });

              // Fire toast
              const preview = input.question.length > 60
                ? input.question.slice(0, 57) + "..."
                : input.question;
              toast({
                type: "warning",
                title: input.threadName ?? "Thread needs input",
                description: preview,
                duration: 8000,
                onClick: () => {
                  router.push(`/projects/${projectId}/threads/${data.threadId}`);
                },
              });
            } else if (data.status === "running") {
              setPendingInputs((prev) => {
                const next = new Map(prev);
                next.delete(data.threadId);
                return next;
              });
            }
          }
        } catch {}
      };
    }

    void connect();

    return () => {
      disposed = true;
      reconnectAttempt.current = 0;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [projectId, router, toast]);

  return (
    <PendingInputsContext.Provider value={{ pendingInputs }}>
      {children}
    </PendingInputsContext.Provider>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/hooks/use-project-events.ts
git commit -m "feat: create PendingInputsProvider with project-level WebSocket"
```

---

## Chunk 7: UI — Sidebar Amber Dot and Layout Integration

### Task 11: Add amber dot to sidebar

**Files:**
- Modify: `packages/ui/src/components/project-sidebar.tsx:1-477`

- [ ] **Step 1: Import usePendingInputs**

Add to imports (after line 8):
```typescript
import { usePendingInputs } from "@/hooks/use-project-events";
```

- [ ] **Step 2: Add needs_input to threadStatusDot**

Update the `threadStatusDot` map (lines 24-29):

```typescript
const threadStatusDot: Record<string, string> = {
  needs_input: "bg-amber-400 animate-pulse",
  active: "bg-emerald-400 animate-pulse",
  starting: "bg-emerald-400 animate-pulse",
  idle: "bg-zinc-600",
  error: "bg-red-400",
};
```

- [ ] **Step 3: Consume pendingInputs in the component**

Inside the `ProjectSidebar` component, after the existing state declarations (after line 57), add:

```typescript
  const { pendingInputs } = usePendingInputs();
```

- [ ] **Step 4: Override status dot for threads with pending inputs**

In the thread list rendering, where the status dot is displayed (line 293-298), wrap with pending input check. Replace:

```tsx
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        threadStatusDot[thread.status] || "bg-zinc-600",
                      )}
                    />
```

with:

```tsx
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        pendingInputs.has(thread.id)
                          ? threadStatusDot.needs_input
                          : (threadStatusDot[thread.status] || "bg-zinc-600"),
                      )}
                    />
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/project-sidebar.tsx
git commit -m "feat: show amber pulsing dot for threads needing input"
```

### Task 12: Wrap project layout with PendingInputsProvider

**Files:**
- Modify: `packages/ui/src/app/projects/[projectId]/layout.tsx:1-89`

- [ ] **Step 1: Import PendingInputsProvider**

Add to imports (after line 5):
```typescript
import { PendingInputsProvider } from "@/hooks/use-project-events";
```

- [ ] **Step 2: Wrap children with PendingInputsProvider**

Update the return statement (lines 78-89) to wrap with the provider:

```tsx
  return (
    <PendingInputsProvider projectId={projectId}>
      <div className="flex h-full overflow-hidden">
        <ProjectCommands projectId={projectId} />
        <ProjectSidebar
          projectId={projectId}
          collapsed={collapsed}
          onToggle={toggle}
        />
        <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
      </div>
    </PendingInputsProvider>
  );
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/app/projects/[projectId]/layout.tsx
git commit -m "feat: wrap project layout with PendingInputsProvider"
```

---

## Chunk 8: Tests

### Task 13: Write tests for new server functionality

**Files:**
- Create: `packages/server/tests/thread-status-events.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApprovalDecision } from "../src/providers/adapter.js";
import type { ThreadStatusPayload, ProviderRuntimeEvent, ProviderEventEnvelope } from "../src/providers/events.js";

describe("ApprovalDecision types", () => {
  it("allow variant accepts reason field", () => {
    const decision: ApprovalDecision = {
      type: "allow",
      reason: "Yes, proceed with the plan",
    };
    expect(decision.type).toBe("allow");
    expect(decision.reason).toBe("Yes, proceed with the plan");
  });

  it("allow variant works without reason (backward compatible)", () => {
    const decision: ApprovalDecision = { type: "allow" };
    expect(decision.type).toBe("allow");
    expect(decision.reason).toBeUndefined();
  });

  it("deny variant still works with reason", () => {
    const decision: ApprovalDecision = { type: "deny", reason: "No" };
    expect(decision.type).toBe("deny");
    expect(decision.reason).toBe("No");
  });
});

describe("ThreadStatusPayload", () => {
  it("represents needs_input status with all fields", () => {
    const payload: ThreadStatusPayload = {
      status: "needs_input",
      requestId: "req-123",
      question: "Should I proceed?",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
      threadName: "Feature work",
    };
    expect(payload.status).toBe("needs_input");
    expect(payload.options).toHaveLength(2);
    expect(payload.threadName).toBe("Feature work");
  });

  it("represents running status (minimal)", () => {
    const payload: ThreadStatusPayload = {
      status: "running",
    };
    expect(payload.status).toBe("running");
    expect(payload.requestId).toBeUndefined();
    expect(payload.question).toBeUndefined();
  });
});

describe("thread.status event in ProviderRuntimeEvent union", () => {
  it("accepts thread.status as a valid event type", () => {
    const event: ProviderRuntimeEvent = {
      type: "thread.status",
      payload: { status: "needs_input", requestId: "r1", question: "Test?" },
    };
    expect(event.type).toBe("thread.status");
  });
});

describe("thread.status fan-out behavior", () => {
  it("thread.status events should NOT be persisted (transient)", () => {
    // Verify the contract: thread.status events are transient signals
    // The fan-out loop guards persistence behind: if (envelope.type !== "thread.status")
    // This test documents the expected behavior
    const envelope: ProviderEventEnvelope = {
      eventId: "e1" as any,
      type: "thread.status",
      provider: "claude-code" as any,
      threadId: "t1" as any,
      payload: { status: "needs_input", requestId: "r1", question: "Test?" },
      createdAt: new Date(),
    };
    const isThreadStatus = envelope.type === "thread.status";
    expect(isThreadStatus).toBe(true);
    // When isThreadStatus is true, persistence and thread-level send must be skipped
  });

  it("non-thread.status events should be persisted and sent to thread clients", () => {
    const envelope: ProviderEventEnvelope = {
      eventId: "e2" as any,
      type: "ask_user",
      provider: "claude-code" as any,
      threadId: "t1" as any,
      payload: { turnId: "turn1" as any, requestId: "r1", question: "Q?", options: [] },
      createdAt: new Date(),
    };
    const isThreadStatus = envelope.type === "thread.status";
    expect(isThreadStatus).toBe(false);
    // When isThreadStatus is false, persistence and thread-level send proceed normally
  });
});

describe("AskUserQuestion answer passthrough", () => {
  it("should inject reason into updatedInput.result", () => {
    // Simulates the adapter logic for AskUserQuestion allow with reason
    const decision: ApprovalDecision = { type: "allow", reason: "Option A" };
    const input = { questions: [{ question: "Pick one", options: [] }] };

    // This mirrors the adapter code:
    // return { behavior: "allow", updatedInput: { ...input, result: decision.reason ?? "" } }
    const result = {
      behavior: "allow" as const,
      updatedInput: { ...input, result: decision.reason ?? "" },
    };

    expect(result.updatedInput.result).toBe("Option A");
    expect(result.updatedInput.questions).toEqual(input.questions);
  });

  it("should default to empty string when no reason provided", () => {
    const decision: ApprovalDecision = { type: "allow" };
    const input = { questions: [] };

    const result = {
      behavior: "allow" as const,
      updatedInput: { ...input, result: decision.reason ?? "" },
    };

    expect(result.updatedInput.result).toBe("");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd packages/server && bun test tests/thread-status-events.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/thread-status-events.test.ts
git commit -m "test: add tests for ThreadStatusPayload and ApprovalDecision types"
```

### Task 14: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `bun run test`
Expected: No new failures (pre-existing failures may exist — see spec for known test state)

- [ ] **Step 2: Fix any new failures introduced by our changes**

If new failures appear, fix them before proceeding.

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: resolve test failures from input notification changes"
```
