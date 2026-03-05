import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Allow login page, onboarding, and API routes through
  if (
    pathname === "/login" ||
    pathname === "/onboarding" ||
    pathname.startsWith("/api/")
  ) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Check for better-auth session cookie
  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
