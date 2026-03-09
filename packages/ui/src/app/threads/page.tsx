"use client";

import Link from "next/link";
import { MessageSquare, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ThreadsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/10 to-primary/10 flex items-center justify-center mb-5">
        <Sparkles className="h-7 w-7 text-violet-500/50" />
      </div>
      <h2 className="text-lg font-semibold text-foreground/80 mb-1.5">Patchwork Threads</h2>
      <p className="text-sm text-muted-foreground/50 mb-6 max-w-xs">
        Start a conversation with an AI agent to build, debug, and deploy code
      </p>
      <Link href="/threads/new">
        <Button className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Thread
        </Button>
      </Link>
    </div>
  );
}
