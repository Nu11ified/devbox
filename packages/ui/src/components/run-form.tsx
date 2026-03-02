"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type CreateRunRequest, type Template, type Blueprint } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

export function RunForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [templateId, setTemplateId] = useState("");
  const [blueprintId, setBlueprintId] = useState("");
  const [description, setDescription] = useState("");
  const [backend, setBackend] = useState<"auto" | "claude" | "codex">("auto");

  const { data: templates } = useApi(() => api.listTemplates(), []);
  const { data: blueprints } = useApi(() => api.listBlueprints(), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo.trim() || !description.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const spec: CreateRunRequest = {
        repo: repo.trim(),
        branch: branch.trim() || "main",
        templateId: templateId || (templates?.[0]?.id ?? ""),
        blueprintId: blueprintId || (blueprints?.[0]?.id ?? ""),
        description: description.trim(),
        preferredBackend: backend,
      };
      const result = await api.createRun(spec);
      router.push(`/runs/${result.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create run");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      <div className="space-y-2">
        <Label htmlFor="repo">Repository URL *</Label>
        <Input
          id="repo"
          placeholder="https://github.com/org/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="branch">Branch</Label>
        <Input
          id="branch"
          placeholder="main"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="template">Template</Label>
        <Select value={templateId} onValueChange={setTemplateId}>
          <SelectTrigger id="template">
            <SelectValue placeholder="Select a template..." />
          </SelectTrigger>
          <SelectContent>
            {templates?.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
            {(!templates || templates.length === 0) && (
              <SelectItem value="default" disabled>
                No templates available
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="blueprint">Blueprint</Label>
        <Select value={blueprintId} onValueChange={setBlueprintId}>
          <SelectTrigger id="blueprint">
            <SelectValue placeholder="Select a blueprint..." />
          </SelectTrigger>
          <SelectContent>
            {blueprints?.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
            {(!blueprints || blueprints.length === 0) && (
              <SelectItem value="default" disabled>
                No blueprints available
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Task Description *</Label>
        <Textarea
          id="description"
          placeholder="Describe what the agent should do..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Agent Preference</Label>
        <RadioGroup
          value={backend}
          onValueChange={(v) => setBackend(v as "auto" | "claude" | "codex")}
          className="flex flex-wrap gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="auto" id="auto" />
            <Label htmlFor="auto" className="font-normal">
              Auto
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="claude" id="claude" />
            <Label htmlFor="claude" className="font-normal">
              Claude
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="codex" id="codex" />
            <Label htmlFor="codex" className="font-normal">
              Codex
            </Label>
          </div>
        </RadioGroup>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={submitting || !repo.trim() || !description.trim()}>
        {submitting ? "Creating..." : "Create Run"}
      </Button>
    </form>
  );
}
