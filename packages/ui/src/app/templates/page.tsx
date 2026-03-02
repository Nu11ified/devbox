"use client";

import { useState } from "react";
import { Trash2, Plus, Cpu, HardDrive, MemoryStick } from "lucide-react";
import { api, type Template, type CreateTemplateRequest } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function CreateTemplateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [baseImage, setBaseImage] = useState("");
  const [cpus, setCpus] = useState("2");
  const [memoryMB, setMemoryMB] = useState("4096");
  const [diskMB, setDiskMB] = useState("10240");
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !baseImage.trim()) return;
    setSubmitting(true);
    try {
      const spec: CreateTemplateRequest = {
        name: name.trim(),
        baseImage: baseImage.trim(),
        toolBundles: [],
        envVars: {},
        bootstrapScripts: [],
        resourceLimits: {
          cpus: Number(cpus) || 2,
          memoryMB: Number(memoryMB) || 4096,
          diskMB: Number(diskMB) || 10240,
        },
        networkPolicy: "restricted",
        repos: [],
      };
      await api.createTemplate(spec);
      setOpen(false);
      setName("");
      setBaseImage("");
      onCreated();
    } catch {
      // ignore for now
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create Template
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="node-20-fullstack"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-image">Base Image</Label>
            <Input
              id="tpl-image"
              value={baseImage}
              onChange={(e) => setBaseImage(e.target.value)}
              placeholder="patchwork/devbox-node:20"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="tpl-cpus">CPUs</Label>
              <Input
                id="tpl-cpus"
                type="number"
                value={cpus}
                onChange={(e) => setCpus(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-mem">Memory (MB)</Label>
              <Input
                id="tpl-mem"
                type="number"
                value={memoryMB}
                onChange={(e) => setMemoryMB(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-disk">Disk (MB)</Label>
              <Input
                id="tpl-disk"
                type="number"
                value={diskMB}
                onChange={(e) => setDiskMB(e.target.value)}
              />
            </div>
          </div>
          <Button
            onClick={handleCreate}
            disabled={submitting || !name.trim() || !baseImage.trim()}
            className="w-full"
          >
            {submitting ? "Creating..." : "Create"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesPage() {
  const { data: templates, loading, error, refetch } = useApi(
    () => api.listTemplates(),
    []
  );
  const [deleting, setDeleting] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await api.deleteTemplate(id);
      refetch();
    } catch {
      // ignore for now
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Templates</h1>
        <CreateTemplateDialog onCreated={refetch} />
      </div>

      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          Loading templates...
        </div>
      )}

      {error && (
        <div className="py-12 text-center text-destructive">
          Failed to load templates: {error.message}
        </div>
      )}

      {templates && templates.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No templates yet. Create one to get started.
        </div>
      )}

      {templates && templates.length > 0 && (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Base Image</TableHead>
                <TableHead className="hidden sm:table-cell">Resources</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.baseImage}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Cpu className="h-3 w-3" />
                        {t.resourceLimits.cpus}
                      </span>
                      <span className="flex items-center gap-1">
                        <MemoryStick className="h-3 w-3" />
                        {t.resourceLimits.memoryMB}MB
                      </span>
                      <span className="flex items-center gap-1">
                        <HardDrive className="h-3 w-3" />
                        {t.resourceLimits.diskMB}MB
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
