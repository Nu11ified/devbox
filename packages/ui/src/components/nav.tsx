"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Play,
  PlusCircle,
  Box,
  Workflow,
  Settings,
  Menu,
  X,
  LayoutGrid,
  LogOut,
  ChevronDown,
  Github,
  MessageSquare,
} from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

const mainLinks = [
  { href: "/board", label: "Board", icon: LayoutGrid },
  { href: "/runs", label: "Runs", icon: Play },
  { href: "/runs/new", label: "New Run", icon: PlusCircle },
  { href: "/threads", label: "Threads", icon: MessageSquare },
  { href: "/templates", label: "Templates", icon: Box },
  { href: "/blueprints", label: "Blueprints", icon: Workflow },
];

const bottomLinks = [
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { data: session } = useSession();

  const user = session?.user;
  const [ghLogin, setGhLogin] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      api.getGitHubUser().then((u) => setGhLogin(u.login)).catch(() => {});
    }
  }, [user]);

  async function handleLogout() {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/login");
          router.refresh();
        },
      },
    });
  }

  const allLinks = [...mainLinks, ...bottomLinks];

  function isActive(href: string) {
    if (href === "/runs") {
      return pathname === "/runs" || (pathname.startsWith("/runs/") && !pathname.startsWith("/runs/new"));
    }
    if (href === "/board") {
      return pathname.startsWith("/board");
    }
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
              <span className="text-xs font-bold text-primary-foreground">P</span>
            </div>
            Patchwork
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {mainLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(link.href)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          ))}
          <div className="flex-1" />
          {bottomLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(link.href)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          ))}

          {/* User profile section */}
          <div className="border-t border-border pt-2 mt-1">
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent/50 group"
              >
                {user?.image ? (
                  <img
                    src={user.image}
                    alt=""
                    className="w-7 h-7 rounded-full border border-border/60 group-hover:border-foreground/20 transition-colors shrink-0"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-muted border border-border/60 flex items-center justify-center shrink-0">
                    <span className="text-xs font-medium text-muted-foreground">
                      {user?.name?.[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[12px] font-medium truncate leading-tight">
                    {user?.name || "User"}
                  </p>
                  <p className="text-[10px] font-mono text-muted-foreground/60 truncate">
                    {user?.email || ""}
                  </p>
                </div>
                <ChevronDown className={cn(
                  "h-3 w-3 text-muted-foreground/50 transition-transform",
                  profileOpen && "rotate-180"
                )} />
              </button>

              {profileOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-md shadow-md overflow-hidden z-50">
                  <div className="px-3 py-3 bg-muted/30 border-b border-border/40">
                    <div className="flex items-start gap-3">
                      {user?.image ? (
                        <img src={user.image} alt="" className="w-9 h-9 rounded-full shrink-0 border border-border/40" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-muted shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0 gap-0.5">
                        <span className="text-[12px] font-medium truncate leading-tight">{user?.name}</span>
                        <span className="text-[10px] text-muted-foreground/50 truncate">{user?.email}</span>
                      </div>
                    </div>
                  </div>
                  <div className="py-1">
                    <a
                      href={`https://github.com/${ghLogin || user?.name}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Github className="h-3.5 w-3.5" />
                      GitHub profile
                    </a>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </nav>
      </aside>

      {/* Mobile top bar */}
      <div className="flex h-14 items-center border-b border-border px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">P</span>
          </div>
          Patchwork
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {user?.image && (
            <img src={user.image} alt="" className="w-6 h-6 rounded-full border border-border/60" />
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(!open)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile dropdown nav */}
      {open && (
        <nav className="flex flex-col gap-1 border-b border-border bg-background p-2 md:hidden">
          {allLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[44px]",
                isActive(link.href)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          ))}
          <button
            onClick={() => { setOpen(false); handleLogout(); }}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors min-h-[44px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </nav>
      )}
    </>
  );
}
