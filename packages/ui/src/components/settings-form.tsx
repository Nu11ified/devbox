"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession, signIn } from "@/lib/auth-client";
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
import { Switch } from "@/components/ui/switch";
import {
  Github,
  Key,
  Sparkles,
  Settings2,
  Cpu,
  Check,
  Lock,
  Globe,
  Star,
  Loader2,
  RefreshCw,
  ExternalLink,
  Shield,
  Zap,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthTerminalModal } from "./auth-terminal-modal";

// ── Types ──────────────────────────────────────────────────────────

type RuntimeMode = "approval-required" | "full-access";
type EffortLevel = "low" | "medium" | "high";

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
  stargazers_count?: number;
  private?: boolean;
  language?: string;
}

const languageColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  Ruby: "#701516",
  "C++": "#f34b7d",
  C: "#555555",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  PHP: "#4F5D95",
};

// ── Section wrapper ────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold flex items-center gap-2 text-zinc-200">
          <Icon className="h-4 w-4 text-zinc-400" />
          {title}
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      {children}
    </section>
  );
}

// ── Subscription toggle row ────────────────────────────────────────

function SubToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-950/30 p-3">
      <div>
        <p className="text-xs font-medium text-zinc-300">{label}</p>
        <p className="text-[11px] text-zinc-500">{description}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

// ── Main form ──────────────────────────────────────────────────────

export function SettingsForm() {
  const { data: session } = useSession();

  // Provider connections
  const [providerStatus, setProviderStatus] = useState<Record<string, any>>({});
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalProvider, setTerminalProvider] = useState<"claude" | "codex">("claude");
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  // GitHub account info
  const [ghUser, setGhUser] = useState<{
    login: string;
    name: string | null;
    avatar_url: string;
    html_url: string;
  } | null>(null);

  // Repo selection
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [reposLoading, setReposLoading] = useState(true);
  const [reposSaving, setReposSaving] = useState(false);
  const [reposDirty, setReposDirty] = useState(false);
  const [repoFilter, setRepoFilter] = useState("");

  // Provider configuration (server-persisted)
  const [defaultProvider, setDefaultProvider] = useState("claude-code");
  const [defaultModel, setDefaultModel] = useState("");
  const [defaultRuntimeMode, setDefaultRuntimeMode] =
    useState<RuntimeMode>("approval-required");
  const [defaultEffort, setDefaultEffort] = useState<EffortLevel>("high");
  const [defaultTeamSize, setDefaultTeamSize] = useState(3);
  const [sshHost, setSshHost] = useState("");

  // Subscription toggles (server-persisted)
  const [claudeSub, setClaudeSub] = useState(false);
  const [openaiSub, setOpenaiSub] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load provider status on mount
  useEffect(() => {
    api.getProviderStatus().then(setProviderStatus).catch(() => {});
  }, []);

  const refreshProviderStatus = () => {
    api.getProviderStatus().then(setProviderStatus).catch(() => {});
  };

  // Load settings + GitHub user + repos on mount
  useEffect(() => {
    api.getGitHubUser().then(setGhUser).catch(() => {});

    api
      .listGitHubRepos()
      .then(setRepos)
      .catch(() => {})
      .finally(() => setReposLoading(false));

    api
      .getSettings()
      .then((s: any) => {
        if (s.claudeSubscription != null) setClaudeSub(s.claudeSubscription);
        if (s.openaiSubscription != null) setOpenaiSub(s.openaiSubscription);
        if (s.defaultProvider) setDefaultProvider(s.defaultProvider);
        if (s.defaultModel) setDefaultModel(s.defaultModel);
        if (s.defaultRuntimeMode) setDefaultRuntimeMode(s.defaultRuntimeMode);
        if (s.defaultEffort) setDefaultEffort(s.defaultEffort);
        if (s.defaultTeamSize) setDefaultTeamSize(s.defaultTeamSize);
        if (s.sshHost) setSshHost(s.sshHost);
        // Populate selected repos from server
        if (Array.isArray(s.selectedRepos)) {
          setSelectedRepos(new Set(s.selectedRepos));
        }
        setSettingsLoaded(true);
      })
      .catch(() => setSettingsLoaded(true));
  }, []);

  // ── Repo selection handlers ─────────────────────────────────────

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
    setReposDirty(true);
  }

  function toggleAll() {
    const filtered = filteredRepos;
    const allSelected = filtered.every((r) => selectedRepos.has(r.full_name));
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      for (const r of filtered) {
        if (allSelected) next.delete(r.full_name);
        else next.add(r.full_name);
      }
      return next;
    });
    setReposDirty(true);
  }

  async function saveRepos() {
    setReposSaving(true);
    try {
      await api.updateSettings({ selectedRepos: Array.from(selectedRepos) });
      setReposDirty(false);
    } finally {
      setReposSaving(false);
    }
  }

  const filteredRepos = repoFilter
    ? repos.filter(
        (r) =>
          r.full_name.toLowerCase().includes(repoFilter.toLowerCase()) ||
          r.description?.toLowerCase().includes(repoFilter.toLowerCase())
      )
    : repos;

  // ── Setting save helpers ────────────────────────────────────────

  const saveProvider = useCallback((v: string) => {
    setDefaultProvider(v);
    api.updateSettings({ defaultProvider: v });
  }, []);

  const saveModel = useCallback((v: string) => {
    setDefaultModel(v);
    api.updateSettings({ defaultModel: v });
  }, []);

  const saveRuntimeMode = useCallback((v: RuntimeMode) => {
    setDefaultRuntimeMode(v);
    api.updateSettings({ defaultRuntimeMode: v });
  }, []);

  const saveEffort = useCallback((v: EffortLevel) => {
    setDefaultEffort(v);
    api.updateSettings({ defaultEffort: v });
  }, []);

  const saveTeamSize = useCallback((v: number) => {
    setDefaultTeamSize(v);
    api.updateSettings({ defaultTeamSize: v });
  }, []);

  const saveSshHost = useCallback((v: string) => {
    setSshHost(v);
    api.updateSettings({ sshHost: v || null });
  }, []);

  async function handleClaudeSubToggle(checked: boolean) {
    setClaudeSub(checked);
    await api.updateSettings({ claudeSubscription: checked });
  }

  async function handleOpenaiSubToggle(checked: boolean) {
    setOpenaiSub(checked);
    await api.updateSettings({ openaiSubscription: checked });
  }

  function handleReauthorize() {
    signIn.social({ provider: "github", callbackURL: "/settings" });
  }

  const user = session?.user;

  return (
    <div className="space-y-5">
      {/* ── GitHub Connection ──────────────────────────────────── */}
      <Section
        icon={Github}
        title="GitHub Connection"
        description="Manage your GitHub account and repository permissions."
      >
        {/* Account info */}
        <div className="flex items-center justify-between rounded-md border border-zinc-800/60 bg-zinc-950/30 p-3">
          <div className="flex items-center gap-3">
            {(ghUser?.avatar_url || user?.image) && (
              <img
                src={ghUser?.avatar_url || user?.image || ""}
                alt=""
                className="w-8 h-8 rounded-full border border-zinc-700/50"
              />
            )}
            <div>
              <p className="text-sm font-medium text-zinc-200">
                {ghUser?.login || user?.name || "GitHub Account"}
              </p>
              <p className="text-[11px] text-zinc-500">
                {ghUser?.name || "Connected via OAuth"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {ghUser?.html_url && (
              <a
                href={ghUser.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleReauthorize}
              className="text-xs border-zinc-800 hover:bg-zinc-800/50 gap-1.5"
            >
              <RefreshCw className="h-3 w-3" />
              Re-authorize
            </Button>
          </div>
        </div>

        {/* Repo selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Monitored Repositories
            </Label>
            {filteredRepos.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-[11px] font-mono text-violet-400 hover:text-violet-300 transition-colors"
              >
                {filteredRepos.every((r) => selectedRepos.has(r.full_name))
                  ? "Deselect all"
                  : "Select all"}
              </button>
            )}
          </div>
          <p className="text-[11px] text-zinc-600">
            Issues labeled{" "}
            <code className="text-[10px] px-1 py-0.5 bg-zinc-800/60 rounded font-mono text-zinc-400">
              patchwork
            </code>{" "}
            in selected repos will auto-sync to your board.
          </p>

          {/* Search repos */}
          {repos.length > 10 && (
            <Input
              placeholder="Filter repositories..."
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              className="bg-zinc-950/50 border-zinc-800/60 text-xs placeholder:text-zinc-600 h-8"
            />
          )}

          <div className="border border-zinc-800/60 rounded-md max-h-64 overflow-y-auto bg-zinc-950/20">
            {reposLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
              </div>
            ) : filteredRepos.length === 0 ? (
              <p className="p-3 text-xs text-zinc-600 text-center">
                {repos.length === 0
                  ? "No repositories found. Try re-authorizing."
                  : "No repos match your filter."}
              </p>
            ) : (
              filteredRepos.map((repo) => (
                <div
                  key={repo.full_name}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleRepo(repo.full_name)}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      toggleRepo(repo.full_name);
                    }
                  }}
                  className={cn(
                    "flex items-start gap-3 px-3 py-2 border-b border-zinc-800/30 last:border-b-0 cursor-pointer transition-colors select-none",
                    selectedRepos.has(repo.full_name)
                      ? "bg-violet-500/5"
                      : "hover:bg-zinc-800/20"
                  )}
                >
                  <div className="mt-0.5 w-4 h-4 rounded border border-zinc-700/60 flex items-center justify-center shrink-0">
                    {selectedRepos.has(repo.full_name) && (
                      <Check className="h-3 w-3 text-violet-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {repo.private ? (
                        <Lock className="h-3 w-3 text-zinc-600" />
                      ) : (
                        <Globe className="h-3 w-3 text-zinc-600" />
                      )}
                      <span className="text-xs font-medium font-mono text-zinc-300">
                        {repo.full_name}
                      </span>
                    </div>
                    {repo.description && (
                      <p className="text-[11px] text-zinc-600 truncate mt-0.5">
                        {repo.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-0.5">
                      {repo.language && (
                        <span className="flex items-center gap-1 text-[10px] text-zinc-600">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor:
                                languageColors[repo.language] || "#8b8b8b",
                            }}
                          />
                          {repo.language}
                        </span>
                      )}
                      {repo.stargazers_count !== undefined &&
                        repo.stargazers_count > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-zinc-600">
                            <Star className="h-2.5 w-2.5" />{" "}
                            {repo.stargazers_count}
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[10px] font-mono text-zinc-600">
              {selectedRepos.size} repo
              {selectedRepos.size !== 1 ? "s" : ""} selected
            </p>
            {reposDirty && (
              <Button
                size="sm"
                onClick={saveRepos}
                disabled={reposSaving}
                className="text-xs h-7 px-3"
              >
                {reposSaving ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    Saving...
                  </>
                ) : (
                  "Save repo selection"
                )}
              </Button>
            )}
          </div>
        </div>
      </Section>

      {/* ── Provider Connections ──────────────────────────────── */}
      <Section
        icon={Key}
        title="Provider Connections"
        description="Connect your AI providers via CLI OAuth or API key. Credentials are encrypted at rest."
      >
        {(["claude", "codex"] as const).map((providerKey) => {
          const status = providerStatus[providerKey];
          const isConnected = status?.connected;
          const isExpired = status?.status === "expired";
          const label = providerKey === "claude" ? "Claude" : "Codex";

          return (
            <div key={providerKey} className="rounded-lg border border-zinc-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{label}</span>
                  {isConnected && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {status.authMethod === "oauth" ? "OAuth" : "API Key"}
                    </span>
                  )}
                  {isExpired && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      Expired
                    </span>
                  )}
                </div>
                {isConnected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await api.disconnectProvider(providerKey);
                      refreshProviderStatus();
                    }}
                  >
                    Disconnect
                  </Button>
                )}
              </div>

              {isExpired && (
                <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/10 rounded p-2">
                  Credentials expired. Please reauthenticate.
                </div>
              )}

              {(!isConnected || isExpired) && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTerminalProvider(providerKey);
                      setTerminalOpen(true);
                    }}
                  >
                    Connect with CLI
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowApiKey(prev => ({ ...prev, [providerKey]: !prev[providerKey] }))}
                  >
                    Use API Key
                  </Button>
                </div>
              )}

              {showApiKey[providerKey] && !isConnected && (
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    placeholder={providerKey === "claude" ? "sk-ant-..." : "sk-..."}
                    value={apiKeyInput[providerKey] || ""}
                    onChange={(e) => setApiKeyInput(prev => ({ ...prev, [providerKey]: e.target.value }))}
                    className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      const key = apiKeyInput[providerKey];
                      if (!key) return;
                      await api.storeProviderApiKey(providerKey, key);
                      setApiKeyInput(prev => ({ ...prev, [providerKey]: "" }));
                      setShowApiKey(prev => ({ ...prev, [providerKey]: false }));
                      refreshProviderStatus();
                    }}
                  >
                    Save
                  </Button>
                </div>
              )}

              {isConnected && status.lastUsedAt && (
                <div className="text-xs text-zinc-500">
                  Last used: {new Date(status.lastUsedAt).toLocaleDateString()}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <AuthTerminalModal
        open={terminalOpen}
        onOpenChange={setTerminalOpen}
        provider={terminalProvider}
        onSuccess={refreshProviderStatus}
      />

      {/* ── Subscriptions ──────────────────────────────────────── */}
      <Section
        icon={Sparkles}
        title="Agent Subscriptions"
        description="Use your own subscriptions instead of API keys. Agents run with the --subscription flag."
      >
        <SubToggle
          label="Claude subscription"
          description="Use your Claude Max/Pro subscription instead of an API key."
          checked={claudeSub}
          onCheckedChange={handleClaudeSubToggle}
          disabled={!settingsLoaded}
        />
        <SubToggle
          label="OpenAI subscription"
          description="Use your OpenAI Plus/Pro subscription instead of an API key."
          checked={openaiSub}
          onCheckedChange={handleOpenaiSubToggle}
          disabled={!settingsLoaded}
        />
      </Section>

      {/* ── Provider Configuration ─────────────────────────────── */}
      <Section
        icon={Cpu}
        title="Provider Configuration"
        description="Default provider settings for new threads and agent sessions."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Provider
            </Label>
            <Select value={defaultProvider} onValueChange={saveProvider}>
              <SelectTrigger className="bg-zinc-950/50 border-zinc-800/60 text-xs h-9">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-code">Claude Code</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Model
            </Label>
            <Input
              placeholder="e.g. claude-sonnet-4-20250514"
              value={defaultModel}
              onChange={(e) => saveModel(e.target.value)}
              className="bg-zinc-950/50 border-zinc-800/60 text-xs font-mono h-9 placeholder:text-zinc-600"
            />
            <p className="text-[10px] text-zinc-600">
              Leave blank for provider default.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            Runtime Mode
          </Label>
          <RadioGroup
            value={defaultRuntimeMode}
            onValueChange={(v) => saveRuntimeMode(v as RuntimeMode)}
            className="flex flex-wrap gap-3"
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem
                value="approval-required"
                id="mode-approval"
                className="border-zinc-700"
              />
              <span className="text-xs text-zinc-300 flex items-center gap-1">
                <Shield className="h-3 w-3 text-zinc-500" />
                Approval Required
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <RadioGroupItem
                value="full-access"
                id="mode-full"
                className="border-zinc-700"
              />
              <span className="text-xs text-zinc-300 flex items-center gap-1">
                <Zap className="h-3 w-3 text-zinc-500" />
                Full Access
              </span>
            </label>
          </RadioGroup>
          <p className="text-[10px] text-zinc-600">
            Controls whether agent actions require manual approval.
          </p>
        </div>
      </Section>

      {/* ── Agent Defaults ─────────────────────────────────────── */}
      <Section
        icon={Settings2}
        title="Agent Defaults"
        description="Defaults applied to new agent sessions and teams."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Effort Level
            </Label>
            <Select
              value={defaultEffort}
              onValueChange={(v) => saveEffort(v as EffortLevel)}
            >
              <SelectTrigger className="bg-zinc-950/50 border-zinc-800/60 text-xs h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low — Faster, less thorough</SelectItem>
                <SelectItem value="medium">Medium — Balanced</SelectItem>
                <SelectItem value="high">High — Thorough, slower</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-zinc-600">
              Controls agent reasoning depth per query.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
              Default Team Size
            </Label>
            <Select
              value={String(defaultTeamSize)}
              onValueChange={(v) => saveTeamSize(Number(v))}
            >
              <SelectTrigger className="bg-zinc-950/50 border-zinc-800/60 text-xs h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} agent{n > 1 ? "s" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-zinc-600">
              Pre-filled when creating new agent teams.
            </p>
          </div>
        </div>
      </Section>

      {/* ── Remote Access ──────────────────────────────────── */}
      <Section
        icon={Globe}
        title="Remote Access"
        description="Configure SSH access for opening thread worktrees in VS Code or Cursor."
      >
        <div className="space-y-1.5">
          <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
            SSH Host
          </Label>
          <Input
            placeholder="e.g. devbox.example.com"
            value={sshHost}
            onChange={(e) => saveSshHost(e.target.value)}
            className="bg-zinc-950/50 border-zinc-800/60 text-xs font-mono h-9 placeholder:text-zinc-600"
          />
          <p className="text-[10px] text-zinc-600">
            The SSH host where your worktrees live. Used by VS Code and Cursor &quot;Open Remote&quot; buttons on threads.
          </p>
        </div>
      </Section>
    </div>
  );
}
