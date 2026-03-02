"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { RunCard } from "@/components/run-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const statuses = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
];

export default function RunsPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [repoFilter, setRepoFilter] = useState("");

  const { data: runs, loading, error } = useApi(
    () =>
      api.listRuns({
        status: statusFilter === "all" ? undefined : statusFilter,
        repo: repoFilter || undefined,
      }),
    [statusFilter, repoFilter]
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Runs</h1>
        <Button asChild size="sm">
          <Link href="/runs/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            New Run
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by repo..."
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          className="w-full sm:w-64"
        />
      </div>

      {/* Content */}
      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          Loading runs...
        </div>
      )}

      {error && (
        <div className="py-12 text-center text-destructive">
          Failed to load runs: {error.message}
        </div>
      )}

      {runs && runs.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted-foreground mb-4">No runs yet. Start one!</p>
          <Button asChild>
            <Link href="/runs/new">
              <PlusCircle className="mr-2 h-4 w-4" />
              Create Run
            </Link>
          </Button>
        </div>
      )}

      {runs && runs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => (
            <RunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
