"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  Puzzle,
  Settings,
  Search,
  LogOut,
  Github,
  ChevronDown,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";

const navLinks = [
  { href: "/board", label: "Board", icon: LayoutGrid },
  { href: "/plugins", label: "Plugins", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user;

  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      api.getGitHubUser().then((u) => setGhLogin(u.login)).catch(() => {});
    }
  }, [user]);

  // Close profile dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
  }, [profileOpen]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    if (href === "/board") return pathname.startsWith("/board");
    return pathname.startsWith(href);
  }

  async function handleLogout() {
    setProfileOpen(false);
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/login");
          router.refresh();
        },
      },
    });
  }

  function openCommandPalette() {
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  }

  return (
    <header className="h-12 w-full bg-zinc-950 border-b border-zinc-800/60 flex items-center px-4 gap-2 shrink-0 relative z-40">
      {/* Left: Logo */}
      <Link
        href="/board"
        className="flex items-center gap-2 shrink-0 mr-2"
      >
        <div className="w-6 h-6 rounded bg-zinc-100 flex items-center justify-center">
          <span className="text-xs font-bold text-zinc-900">P</span>
        </div>
        <span className="text-sm font-semibold text-zinc-100 hidden sm:inline">
          Patchwork
        </span>
      </Link>

      {/* Center-left: Nav links (desktop) */}
      <nav className="hidden md:flex items-center gap-0.5 ml-2">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive(link.href)
                ? "bg-zinc-800/50 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30",
            )}
          >
            <link.icon className="h-4 w-4" />
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Center-right: Cmd+K trigger */}
      <button
        onClick={openCommandPalette}
        className="hidden sm:flex items-center gap-2 text-zinc-500 bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-1 text-xs hover:text-zinc-400 hover:border-zinc-600/50 transition-colors mr-2"
      >
        <Search className="h-3 w-3" />
        <span className="hidden lg:inline text-zinc-500">Search...</span>
        <kbd className="ml-1 text-zinc-600 font-mono text-[10px]">
          {"\u2318"}K
        </kbd>
      </button>

      {/* Right: User avatar dropdown (desktop) */}
      {user && (
        <div ref={profileRef} className="relative hidden md:block">
          <button
            onClick={() => setProfileOpen(!profileOpen)}
            className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-zinc-800/40 group"
          >
            {user.image ? (
              <img
                src={user.image}
                alt=""
                className="w-6 h-6 rounded-full border border-zinc-700/60 group-hover:border-zinc-600 transition-colors"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700/60 flex items-center justify-center">
                <span className="text-[10px] font-medium text-zinc-400">
                  {user.name?.[0]?.toUpperCase() || "?"}
                </span>
              </div>
            )}
            <ChevronDown
              className={cn(
                "h-3 w-3 text-zinc-500 transition-transform",
                profileOpen && "rotate-180",
              )}
            />
          </button>

          {/* Dropdown */}
          {profileOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl overflow-hidden z-50">
              <div className="px-3 py-3 bg-zinc-800/30 border-b border-zinc-800/60">
                <div className="flex items-start gap-3">
                  {user.image ? (
                    <img
                      src={user.image}
                      alt=""
                      className="w-8 h-8 rounded-full border border-zinc-700/40 shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-zinc-800 shrink-0" />
                  )}
                  <div className="flex flex-col min-w-0 gap-0.5">
                    <span className="text-[12px] font-medium text-zinc-200 truncate leading-tight">
                      {user.name}
                    </span>
                    <span className="text-[10px] text-zinc-500 truncate">
                      {user.email}
                    </span>
                  </div>
                </div>
              </div>
              <div className="py-1">
                <a
                  href={`https://github.com/${ghLogin || user.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors"
                >
                  <Github className="h-3.5 w-3.5" />
                  GitHub profile
                </a>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile: hamburger */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="md:hidden flex items-center justify-center w-8 h-8 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors"
      >
        {mobileMenuOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
      </button>

      {/* Mobile dropdown */}
      {mobileMenuOpen && (
        <div className="absolute top-12 left-0 right-0 bg-zinc-950 border-b border-zinc-800/60 z-50 md:hidden">
          <nav className="flex flex-col p-2 gap-0.5">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive(link.href)
                    ? "bg-zinc-800/50 text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30",
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.label}
              </Link>
            ))}
            <button
              onClick={openCommandPalette}
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 transition-colors"
            >
              <Search className="h-4 w-4" />
              Command Palette
            </button>
            <div className="border-t border-zinc-800/60 my-1" />
            {user && (
              <div className="flex items-center gap-3 px-3 py-2">
                {user.image ? (
                  <img
                    src={user.image}
                    alt=""
                    className="w-6 h-6 rounded-full border border-zinc-700/60"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700/60 flex items-center justify-center">
                    <span className="text-[10px] font-medium text-zinc-400">
                      {user.name?.[0]?.toUpperCase() || "?"}
                    </span>
                  </div>
                )}
                <span className="text-sm text-zinc-300 truncate flex-1">
                  {user.name}
                </span>
              </div>
            )}
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                handleLogout();
              }}
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}
