"use client";

import { usePathname } from "next/navigation";
import { Nav } from "@/components/nav";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  if (isLogin) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden">
      <Nav />
      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
