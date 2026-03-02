"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { BlueprintDag } from "@/components/blueprint-dag";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

export default function BlueprintDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: blueprint, loading, error } = useApi(
    () => api.getBlueprint(id),
    [id]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading blueprint...
      </div>
    );
  }

  if (error || !blueprint) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-destructive">
        <p>Failed to load blueprint</p>
        <Button asChild variant="outline">
          <Link href="/blueprints">Back to Blueprints</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/blueprints">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{blueprint.name}</h1>
          <p className="text-sm text-muted-foreground">
            {blueprint.description}
          </p>
        </div>
        <Badge variant="outline" className="ml-auto">
          v{blueprint.version}
        </Badge>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold mb-3">DAG Visualization</h2>
        <div className="rounded-md border border-border p-4 bg-card overflow-x-auto -mx-4 sm:mx-0 px-4">
          <BlueprintDag blueprint={blueprint} />
        </div>
      </div>

      <Separator />

      <div>
        <h2 className="text-lg font-semibold mb-3">Nodes</h2>
        <div className="space-y-2">
          {blueprint.nodes.map((node) => (
            <div
              key={node.id}
              className="flex flex-col gap-1 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:gap-3"
            >
              <Badge variant={node.type === "agent" ? "default" : "secondary"} className="w-fit">
                {node.type}
              </Badge>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{node.label}</span>
                {node.agentConfig && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({node.agentConfig.role} &middot;{" "}
                    {node.agentConfig.preferredBackends.join(", ")})
                  </span>
                )}
                {node.command && (
                  <span className="block sm:inline sm:ml-2 text-xs text-muted-foreground font-mono truncate">
                    {node.command}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Edges</h2>
        <div className="space-y-1">
          {blueprint.edges.map((edge, i) => (
            <div key={i} className="text-sm text-muted-foreground">
              {edge.from} → {edge.to}{" "}
              <Badge variant="outline" className="text-xs">
                {edge.condition}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
