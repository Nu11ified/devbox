"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Users, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NewTeamDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

function generateAgentNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `agent-${i + 1}`);
}

export function NewTeamDialog({ projectId, open, onClose }: NewTeamDialogProps) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [agentCount, setAgentCount] = useState(3);
  const [agentNames, setAgentNames] = useState<string[]>(generateAgentNames(3));
  const [runtimeMode, setRuntimeMode] = useState<"bypassPermissions" | "plan">("bypassPermissions");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sync agent names when count changes
  useEffect(() => {
    setAgentNames((prev) => {
      const next = generateAgentNames(agentCount);
      // Preserve existing names where possible
      return next.map((defaultName, i) =>
        prev[i] !== undefined && prev[i] !== "" ? prev[i] : defaultName
      );
    });
  }, [agentCount]);

  function handleAgentCountChange(value: number) {
    setAgentCount(value);
  }

  function handleAgentNameChange(index: number, value: string) {
    setAgentNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Team name is required.");
      return;
    }

    setSubmitting(true);
    try {
      const team = await api.createTeam(projectId, {
        name: name.trim(),
        agentCount,
        agentNames,
        runtimeMode,
        initialPrompt: initialPrompt.trim() || undefined,
      });
      router.push(`/projects/${projectId}/teams/${team.id}`);
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to create team.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (!submitting) onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Dialog card */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Users className="h-4 w-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-zinc-100">New Team</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-5">
          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Team name */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Team Name <span className="text-red-400">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. backend-team"
              autoFocus
              disabled={submitting}
            />
          </div>

          {/* Number of agents */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Number of Agents
              </Label>
              <span className="text-xs font-mono text-zinc-300 tabular-nums">
                {agentCount}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={6}
              value={agentCount}
              onChange={(e) => handleAgentCountChange(Number(e.target.value))}
              disabled={submitting}
              className={cn(
                "w-full h-1.5 rounded-full appearance-none cursor-pointer",
                "bg-zinc-700 accent-violet-500",
                "disabled:opacity-40 disabled:cursor-not-allowed"
              )}
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-600">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i + 1}>{i + 1}</span>
              ))}
            </div>
          </div>

          {/* Agent names */}
          <div className="space-y-2">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Agent Names
            </Label>
            <div className="space-y-1.5">
              {agentNames.map((agentName, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-600 w-8 shrink-0">
                    {index === 0 ? "lead" : `#${index + 1}`}
                  </span>
                  <Input
                    value={agentName}
                    onChange={(e) => handleAgentNameChange(index, e.target.value)}
                    placeholder={`agent-${index + 1}`}
                    disabled={submitting}
                    className="h-7 text-xs font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Runtime mode */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Runtime Mode
            </Label>
            <div className="flex rounded-md border border-zinc-700 overflow-hidden text-xs font-mono">
              <button
                type="button"
                onClick={() => setRuntimeMode("bypassPermissions")}
                disabled={submitting}
                className={cn(
                  "flex-1 py-1.5 px-3 transition-colors",
                  runtimeMode === "bypassPermissions"
                    ? "bg-violet-600 text-white"
                    : "bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                )}
              >
                Full Access
              </button>
              <button
                type="button"
                onClick={() => setRuntimeMode("plan")}
                disabled={submitting}
                className={cn(
                  "flex-1 py-1.5 px-3 transition-colors border-l border-zinc-700",
                  runtimeMode === "plan"
                    ? "bg-violet-600 text-white"
                    : "bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                )}
              >
                Approval Required
              </button>
            </div>
            <p className="text-[10px] text-zinc-600 font-mono">
              {runtimeMode === "bypassPermissions"
                ? "Agents can execute tools without approval."
                : "Agents will pause and request approval before executing tools."}
            </p>
          </div>

          {/* Initial prompt */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Initial Prompt{" "}
              <span className="normal-case tracking-normal text-zinc-600">(optional)</span>
            </Label>
            <Textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="Sent to all agents when the team is created…"
              disabled={submitting}
              rows={3}
              className="resize-none text-sm"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={submitting}
              className="font-mono"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !name.trim()}
              className="font-mono bg-violet-600 hover:bg-violet-500 text-white border-0"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Users className="mr-1.5 h-3.5 w-3.5" />
                  Create Team
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
