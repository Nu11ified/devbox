"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Nav } from "@/components/nav";
import { api } from "@/lib/api";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Skip onboarding check for login and onboarding pages
    if (isLogin || isOnboarding) {
      setChecked(true);
      return;
    }

    api.getOnboardingStatus()
      .then((status) => {
        if (!status.completed) {
          router.push("/onboarding");
        }
        setChecked(true);
      })
      .catch(() => {
        // If the check fails (e.g., not authenticated yet), just show the page
        setChecked(true);
      });
  }, [isLogin, isOnboarding, router]);

  if (isLogin || isOnboarding) {
    return <>{children}</>;
  }

  if (!checked) {
    return null; // Brief loading state while checking onboarding
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
