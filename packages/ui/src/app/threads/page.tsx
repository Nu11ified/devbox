"use client";

import Link from "next/link";
import { MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ThreadsPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <MessageSquare className="h-10 w-10 text-muted-foreground/20 mb-4" />
      <p className="text-sm text-muted-foreground mb-4">
        Select a thread or create a new one
      </p>
      <Link href="/threads/new">
        <Button size="sm" variant="outline">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Thread
        </Button>
      </Link>
    </div>
  );
}
