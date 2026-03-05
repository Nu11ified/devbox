import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "patchwork-auth";

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Allow login page and API routes through
  if (pathname === "/login" || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Check for auth cookie
  const auth = req.cookies.get(AUTH_COOKIE);
  if (!auth) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
