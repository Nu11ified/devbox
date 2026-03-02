"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Play,
  PlusCircle,
  Box,
  Workflow,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/runs/new", label: "New Run", icon: PlusCircle },
  { href: "/templates", label: "Templates", icon: Box },
  { href: "/blueprints", label: "Blueprints", icon: Workflow },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            Patchwork
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {links.map((link) => {
            const active =
              link.href === "/runs"
                ? pathname === "/runs" || (pathname.startsWith("/runs/") && !pathname.startsWith("/runs/new"))
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Mobile top bar */}
      <div className="flex h-14 items-center border-b border-border px-4 md:hidden">
        <Link href="/" className="text-lg font-bold tracking-tight">
          Patchwork
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          onClick={() => setOpen(!open)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile dropdown nav */}
      {open && (
        <nav className="flex flex-col gap-1 border-b border-border bg-background p-2 md:hidden">
          {links.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
