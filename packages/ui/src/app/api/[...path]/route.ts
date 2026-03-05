import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SERVER_URL = process.env.API_SERVER_URL || "http://localhost:3001";
const AUTH_COOKIE = "patchwork-auth";

// POST /api/auth/login — verify credentials and set cookie
async function handleLogin(req: NextRequest): Promise<NextResponse> {
  const { username, password } = await req.json();
  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }

  const credentials = Buffer.from(`${username}:${password}`).toString("base64");

  // Verify credentials against a protected endpoint
  const check = await fetch(`${SERVER_URL}/api/templates`, {
    headers: { Authorization: `Basic ${credentials}` },
  });

  if (!check.ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, credentials, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return res;
}

// POST /api/auth/logout — clear cookie
function handleLogout(): NextResponse {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(AUTH_COOKIE);
  return res;
}

// Proxy any other request to the backend server
async function proxy(req: NextRequest, path: string): Promise<NextResponse> {
  const url = `${SERVER_URL}/api/${path}${req.nextUrl.search}`;

  const headers = new Headers();
  headers.set("Content-Type", "application/json");

  // Inject auth from cookie
  const cookieStore = await cookies();
  const authCookie = cookieStore.get(AUTH_COOKIE);
  if (authCookie) {
    headers.set("Authorization", `Basic ${authCookie.value}`);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    if (body) init.body = body;
  }

  const upstream = await fetch(url, init);

  // Stream the response back
  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "transfer-encoding") {
      resHeaders.set(key, value);
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

  if (joined === "auth/login" && req.method === "POST") {
    return handleLogin(req);
  }
  if (joined === "auth/logout" && req.method === "POST") {
    return handleLogout();
  }

  return proxy(req, joined);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
