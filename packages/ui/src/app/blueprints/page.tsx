"use client";

import Link from "next/link";
import { Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BlueprintsPage() {
  const { data: blueprints, loading, error } = useApi(
    () => api.listBlueprints(),
    []
  );

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-2xl font-bold">Blueprints</h1>
      <p className="text-muted-foreground">
        Browse and manage blueprint definitions for orchestrating agent runs.
      </p>

      {loading && (
        <div className="py-12 text-center text-muted-foreground">
          Loading blueprints...
        </div>
      )}

      {error && (
        <div className="py-12 text-center text-destructive">
          Failed to load blueprints: {error.message}
        </div>
      )}

      {blueprints && blueprints.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No blueprints available yet.
        </div>
      )}

      {blueprints && blueprints.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {blueprints.map((bp) => (
            <Link key={bp.id} href={`/blueprints/${bp.id}`}>
              <Card className="transition-colors hover:bg-accent/50 h-full">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Workflow className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{bp.name}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {bp.description}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{bp.nodes.length} nodes</span>
                    <span>{bp.edges.length} edges</span>
                    <span>v{bp.version}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
