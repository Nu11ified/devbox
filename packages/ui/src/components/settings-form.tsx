"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Blueprint } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type AgentPref = "auto" | "claude" | "codex" | "both";

interface AuthStatus {
  claude: { connected: boolean };
  codex: { connected: boolean };
}

function TokenField({
  label,
  provider,
  connected,
  onSave,
  onRemove,
}: {
  label: string;
  provider: "claude" | "codex";
  connected: boolean;
  onSave: (provider: "claude" | "codex", token: string) => Promise<void>;
  onRemove: (provider: "claude" | "codex") => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleSave() {
    if (!token.trim()) return;
    setSaving(true);
    try {
      await onSave(provider, token.trim());
      setToken("");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await onRemove(provider);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">{label}</Label>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            connected
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
          }`}
        >
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder={connected ? "••••••••" : "Enter API token..."}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !token.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
        {connected && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRemove}
            disabled={removing}
          >
            {removing ? "..." : "Remove"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function SettingsForm() {
  const { data: authStatus, refetch: refetchAuth } = useApi<AuthStatus>(
    () => api.getAuthStatus(),
    [],
  );
  const { data: blueprints } = useApi(() => api.listBlueprints(), []);

  // Preferences from localStorage
  const [agentPref, setAgentPref] = useState<AgentPref>("auto");
  const [defaultBlueprint, setDefaultBlueprint] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("patchwork:agentPref");
    if (stored) setAgentPref(stored as AgentPref);
    const bp = localStorage.getItem("patchwork:defaultBlueprint");
    if (bp) setDefaultBlueprint(bp);
  }, []);

  const saveAgentPref = useCallback((v: AgentPref) => {
    setAgentPref(v);
    localStorage.setItem("patchwork:agentPref", v);
  }, []);

  const saveDefaultBlueprint = useCallback((v: string) => {
    setDefaultBlueprint(v);
    localStorage.setItem("patchwork:defaultBlueprint", v);
  }, []);

  async function handleSaveToken(provider: "claude" | "codex", token: string) {
    await api.saveToken(provider, token);
    refetchAuth();
  }

  async function handleRemoveToken(provider: "claude" | "codex") {
    await api.removeToken(provider);
    refetchAuth();
  }

  return (
    <div className="space-y-8">
      {/* Agent Credentials */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Agent Credentials</h2>
          <p className="text-sm text-muted-foreground">
            API tokens are encrypted at rest and injected into devbox containers.
          </p>
        </div>

        <TokenField
          label="Claude Code"
          provider="claude"
          connected={authStatus?.claude.connected ?? false}
          onSave={handleSaveToken}
          onRemove={handleRemoveToken}
        />

        <TokenField
          label="Codex"
          provider="codex"
          connected={authStatus?.codex.connected ?? false}
          onSave={handleSaveToken}
          onRemove={handleRemoveToken}
        />
      </section>

      <Separator />

      {/* Preferences */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Preferences</h2>
          <p className="text-sm text-muted-foreground">
            Defaults for new runs. Stored locally in your browser.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Default Agent</Label>
          <RadioGroup
            value={agentPref}
            onValueChange={(v) => saveAgentPref(v as AgentPref)}
            className="flex flex-wrap gap-4"
          >
            {(["auto", "claude", "codex", "both"] as const).map((v) => (
              <div key={v} className="flex items-center gap-2">
                <RadioGroupItem value={v} id={`pref-${v}`} />
                <Label htmlFor={`pref-${v}`} className="font-normal capitalize">
                  {v}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label>Default Blueprint</Label>
          <Select value={defaultBlueprint} onValueChange={saveDefaultBlueprint}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="None (use first available)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {blueprints?.map((b: Blueprint) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}
