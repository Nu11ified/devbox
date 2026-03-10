import type {
  RunStatus,
  BlueprintDefinition,
  DevboxTemplate,
} from "@patchwork/shared";

// ── UI-specific types ──────────────────────────────────────────────

export interface Run {
  id: string;
  status: RunStatus;
  repo: string;
  branch: string;
  description: string;
  blueprintId: string;
  backend: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunStep {
  id: string;
  nodeId: string;
  status: string;
  startedAt: string;
  endedAt?: string;
}

export interface Patch {
  id: string;
  stepId: string;
  agentRole: string;
  files: string[];
  createdAt: string;
}

export interface RunDetail extends Run {
  steps: RunStep[];
  patches: Patch[];
  currentNode: string;
}

export interface TranscriptEvent {
  id: string;
  type: string;
  content: string;
  timestamp: string;
}

export interface TranscriptPage {
  events: TranscriptEvent[];
  cursor?: string;
  hasMore: boolean;
}

export interface CreateRunRequest {
  description: string;
  repo: string;
  branch: string;
  templateId: string;
  blueprintId: string;
  preferredBackend?: "claude" | "codex" | "auto";
  config?: Record<string, unknown>;
}

export interface CreateTemplateRequest {
  name: string;
  baseImage: string;
  toolBundles: string[];
  envVars: Record<string, string>;
  bootstrapScripts: string[];
  resourceLimits: { cpus: number; memoryMB: number; diskMB: number };
  networkPolicy: "restricted" | "egress-allowed";
  repos: string[];
}

export interface Devbox {
  id: string;
  templateId: string;
  containerId: string;
  status: string;
  createdAt: string;
}

export interface CreateDevboxRequest {
  templateId: string;
  repo?: string;
  branch?: string;
}

export interface IssueItem {
  id: string;
  identifier: string;
  title: string;
  body: string;
  repo: string;
  branch: string;
  status: string;
  priority: number;
  blueprintId: string;
  templateId: string | null;
  assignee: string | null;
  runId: string | null;
  labels: string[];
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  githubIssueId?: number | null;
  githubIssueUrl?: string | null;
  githubSyncedAt?: string | null;
  prUrl?: string | null;
  archivedAt?: string | null;
  createdByUserId?: string | null;
  projectId?: string | null;
  thread?: {
    id: string;
    status: string;
    worktreeBranch: string | null;
  } | null;
}

export interface ArchiveSearchResult {
  id: string;
  identifier: string;
  title: string;
  body: string;
  status: string;
  priority: number;
  repo: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  prUrl: string | null;
  projectId: string | null;
  projectName: string | null;
  threadId: string | null;
  snippet: string | null;
}

export interface ArchiveSearchResponse {
  results: ArchiveSearchResult[];
  total?: number;
  page: number;
  limit: number;
}

export interface CreateIssueRequest {
  title: string;
  body?: string;
  repo?: string;
  branch?: string;
  priority?: number;
  blueprintId?: string;
  templateId?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
}

export type Template = DevboxTemplate;
export type Blueprint = BlueprintDefinition;

export interface PluginItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  icon: string | null;
  tags: string[];
  version: string;
  builtIn: boolean;
  installCount: number;
  installed: boolean;
  installedAt: string | null;
}

export interface PluginDetail extends PluginItem {
  instructions: string | null;
  mcpServers: Record<string, unknown>;
  hooks: unknown[];
  tools: unknown[];
}

export interface ProjectItem {
  id: string;
  name: string;
  repo: string;
  branch: string;
  status: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  _count?: { threads: number; issues: number };
}

export interface ProjectDetail extends ProjectItem {
  threads: Array<{
    id: string;
    title: string;
    status: string;
    provider: string;
    model: string | null;
    worktreeBranch: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  issues: Array<{
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: number;
    labels: string[];
  }>;
}

export interface CreateProjectRequest {
  name: string;
  repo: string;
  branch?: string;
}

// ── API Client ─────────────────────────────────────────────────────

// API requests are proxied through Next.js rewrites (same origin, no CORS)
const API_BASE = "";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

class PatchworkAPI {
  // Runs
  async listRuns(filters?: {
    status?: string;
    repo?: string;
  }): Promise<Run[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.repo) params.set("repo", filters.repo);
    const qs = params.toString();
    return request<Run[]>(`/api/runs${qs ? `?${qs}` : ""}`);
  }

  async getRun(id: string): Promise<RunDetail> {
    return request<RunDetail>(`/api/runs/${id}`);
  }

  async createRun(spec: CreateRunRequest): Promise<{ runId: string }> {
    return request<{ runId: string }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(spec),
    });
  }

  async cancelRun(id: string): Promise<void> {
    return request<void>(`/api/runs/${id}/cancel`, { method: "POST" });
  }

  async getRunPatches(id: string): Promise<Patch[]> {
    return request<Patch[]>(`/api/runs/${id}/patches`);
  }

  async getRunDiff(id: string): Promise<string> {
    return request<string>(`/api/runs/${id}/diff`);
  }

  async getRunTranscript(
    id: string,
    cursor?: string,
  ): Promise<TranscriptPage> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return request<TranscriptPage>(`/api/runs/${id}/transcript${qs}`);
  }

  // Templates
  async listTemplates(): Promise<Template[]> {
    return request<Template[]>("/api/templates");
  }

  async getTemplate(id: string): Promise<Template> {
    return request<Template>(`/api/templates/${id}`);
  }

  async createTemplate(template: CreateTemplateRequest): Promise<Template> {
    return request<Template>("/api/templates", {
      method: "POST",
      body: JSON.stringify(template),
    });
  }

  async updateTemplate(
    id: string,
    template: Partial<CreateTemplateRequest>,
  ): Promise<Template> {
    return request<Template>(`/api/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(template),
    });
  }

  async deleteTemplate(id: string): Promise<void> {
    return request<void>(`/api/templates/${id}`, { method: "DELETE" });
  }

  // Devboxes
  async listDevboxes(): Promise<Devbox[]> {
    return request<Devbox[]>("/api/devboxes");
  }

  async createDevbox(options: CreateDevboxRequest): Promise<Devbox> {
    return request<Devbox>("/api/devboxes", {
      method: "POST",
      body: JSON.stringify(options),
    });
  }

  async deleteDevbox(id: string): Promise<void> {
    return request<void>(`/api/devboxes/${id}`, { method: "DELETE" });
  }

  // Blueprints (read-only)
  async listBlueprints(): Promise<Blueprint[]> {
    return request<Blueprint[]>("/api/blueprints");
  }

  async getBlueprint(id: string): Promise<Blueprint> {
    return request<Blueprint>(`/api/blueprints/${id}`);
  }

  // Issues
  async listIssues(filters?: {
    status?: string;
    repo?: string;
    priority?: number;
  }): Promise<IssueItem[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.repo) params.set("repo", filters.repo);
    if (filters?.priority !== undefined) params.set("priority", String(filters.priority));
    const qs = params.toString();
    return request<IssueItem[]>(`/api/issues${qs ? `?${qs}` : ""}`);
  }

  async getIssue(id: string): Promise<IssueItem> {
    return request<IssueItem>(`/api/issues/${id}`);
  }

  async createIssue(input: CreateIssueRequest): Promise<IssueItem> {
    return request<IssueItem>("/api/issues", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateIssue(id: string, fields: Partial<CreateIssueRequest & { status: string }>): Promise<IssueItem> {
    return request<IssueItem>(`/api/issues/${id}`, {
      method: "PUT",
      body: JSON.stringify(fields),
    });
  }

  async deleteIssue(id: string): Promise<void> {
    return request<void>(`/api/issues/${id}`, { method: "DELETE" });
  }

  async dispatchIssue(id: string): Promise<IssueItem & { thread?: { id: string; status: string; worktreeBranch: string | null } }> {
    return request<IssueItem & { thread?: { id: string; status: string; worktreeBranch: string | null } }>(`/api/issues/${id}/dispatch`, { method: "POST" });
  }

  // Archive
  async searchArchive(params?: {
    q?: string;
    projectId?: string;
    page?: number;
    limit?: number;
  }): Promise<ArchiveSearchResponse> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.projectId) qs.set("projectId", params.projectId);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<ArchiveSearchResponse>(`/api/archive${query ? `?${query}` : ""}`);
  }

  // GitHub
  async getGitHubUser(): Promise<{ login: string; name: string | null; avatar_url: string; html_url: string }> {
    return request("/api/github/user");
  }

  async listGitHubRepos(): Promise<any[]> {
    return request<any[]>("/api/github/repos");
  }

  async listGitHubBranches(owner: string, repo: string): Promise<{ name: string; protected: boolean }[]> {
    return request<{ name: string; protected: boolean }[]>(`/api/github/repos/${owner}/${repo}/branches`);
  }

  async listGitHubIssues(owner: string, repo: string): Promise<any[]> {
    return request<any[]>(`/api/github/repos/${owner}/${repo}/issues`);
  }

  async importGitHubIssues(
    owner: string,
    repo: string,
    issueNumbers: number[]
  ): Promise<{ imported: string[]; skipped: number[] }> {
    return request("/api/github/import", {
      method: "POST",
      body: JSON.stringify({ owner, repo, issueNumbers }),
    });
  }

  async syncGitHub(): Promise<{ synced: number }> {
    return request("/api/github/sync", { method: "POST" });
  }

  // Settings
  async getSettings(): Promise<any> {
    return request("/api/settings");
  }

  async updateSettings(settings: Record<string, unknown>): Promise<any> {
    return request("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    });
  }

  async getOnboardingStatus(): Promise<{ completed: boolean }> {
    return request("/api/settings/onboarding");
  }

  // Auth
  async getAuthStatus(): Promise<{
    claude: { connected: boolean };
    codex: { connected: boolean };
  }> {
    return request("/api/auth/status");
  }

  async saveToken(
    provider: "claude" | "codex",
    token: string,
  ): Promise<{ ok: boolean }> {
    return request("/api/auth/tokens", {
      method: "POST",
      body: JSON.stringify({ provider, token }),
    });
  }

  async removeToken(provider: "claude" | "codex"): Promise<void> {
    return request(`/api/auth/tokens/${provider}`, { method: "DELETE" });
  }

  // Health
  async health(): Promise<{ status: string; version: string }> {
    return request<{ status: string; version: string }>("/api/health");
  }

  // ── Thread API ──────────────────────────────────────────────────
  async listThreads(): Promise<any[]> {
    return request<any[]>("/api/threads");
  }

  async getThread(id: string): Promise<any> {
    return request<any>(`/api/threads/${id}`);
  }

  async createPR(threadId: string): Promise<{ prUrl: string; prNumber: number }> {
    return request<{ prUrl: string; prNumber: number }>(`/api/threads/${threadId}/pr`, {
      method: "POST",
    });
  }

  async createThread(data: {
    title: string;
    provider: string;
    model?: string;
    runtimeMode?: string;
    workspacePath?: string;
    useSubscription?: boolean;
    issueId?: string;
    repo?: string;
    branch?: string;
    projectId?: string;
    worktreeBranch?: string;
  }): Promise<any> {
    return request<any>("/api/threads", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async sendTurn(threadId: string, text: string, model?: string): Promise<any> {
    return request<any>(`/api/threads/${threadId}/turns`, {
      method: "POST",
      body: JSON.stringify({ text, model }),
    });
  }

  async approveRequest(
    threadId: string,
    requestId: string,
    decision: string,
  ): Promise<any> {
    return request<any>(`/api/threads/${threadId}/approve`, {
      method: "POST",
      body: JSON.stringify({ requestId, decision: { type: decision } }),
    });
  }

  async stopThread(threadId: string): Promise<any> {
    return request<any>(`/api/threads/${threadId}/stop`, { method: "POST" });
  }

  async interruptThread(threadId: string): Promise<any> {
    return request<any>(`/api/threads/${threadId}/interrupt`, {
      method: "POST",
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    return request<void>(`/api/threads/${threadId}`, {
      method: "DELETE",
    });
  }

  async getWsTicket(): Promise<string> {
    const res = await request<{ ticket: string }>("/api/ws-ticket", {
      method: "POST",
    });
    return res.ticket;
  }

  // ── Projects API ──────────────────────────────────────────────────
  async listProjects(): Promise<ProjectItem[]> {
    return request<ProjectItem[]>("/api/projects");
  }

  async getProject(id: string): Promise<ProjectDetail> {
    return request<ProjectDetail>(`/api/projects/${id}`);
  }

  async createProject(input: CreateProjectRequest): Promise<ProjectItem> {
    return request<ProjectItem>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async deleteProject(id: string): Promise<void> {
    return request<void>(`/api/projects/${id}`, { method: "DELETE" });
  }

  async mergeProjectPRs(projectId: string): Promise<{ prUrl: string; prNumber: number }> {
    return request<{ prUrl: string; prNumber: number }>(`/api/projects/${projectId}/merge-prs`, {
      method: "POST",
    });
  }

  // ── Plugins API ──────────────────────────────────────────────────
  async listPlugins(): Promise<PluginItem[]> {
    return request<PluginItem[]>("/api/plugins");
  }

  async getPlugin(id: string): Promise<PluginDetail> {
    return request<PluginDetail>(`/api/plugins/${id}`);
  }

  async getInstalledPlugins(): Promise<PluginItem[]> {
    return request<PluginItem[]>("/api/plugins/user/installed");
  }

  async installPlugin(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/plugins/${id}/install`, {
      method: "POST",
    });
  }

  async uninstallPlugin(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/plugins/${id}/install`, {
      method: "DELETE",
    });
  }
}

export const api = new PatchworkAPI();
