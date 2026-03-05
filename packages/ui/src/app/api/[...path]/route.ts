import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SERVER_URL = process.env.API_SERVER_URL || "http://localhost:3001";

// Proxy requests to the backend server, forwarding all cookies
async function proxy(req: NextRequest, path: string): Promise<NextResponse> {
  const url = `${SERVER_URL}/api/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  // Forward all cookies to backend (includes better-auth session cookie)
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    if (body) init.body = body;
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, init);
  } catch (err) {
    console.error(`[proxy] Failed to reach backend at ${url}:`, err);
    return NextResponse.json(
      { error: "Cannot reach backend server" },
      { status: 502 },
    );
  }

  // Forward the response back, including Set-Cookie headers
  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding") {
      resHeaders.append(key, value);
    }
  });

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204, headers: resHeaders });
  }

  const responseBody = await upstream.text();
  return new NextResponse(responseBody, {
    status: upstream.status,
    headers: resHeaders,
  });
}

// Route dispatcher
async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await params;
  const joined = path.join("/");

  // All auth/* routes are handled by the better-auth catch-all at /api/auth/[...all]
  // This proxy only handles non-auth API routes
  return proxy(req, joined);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
