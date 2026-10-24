import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ message: "Invalid request." }, { status: 400 }); }
  const apiBase = process.env.API_BASE_URL || "http://localhost:4000";
  try {
    const upstream = await fetch(`${apiBase}/api/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const payload = await upstream.json();
    if (!upstream.ok) return NextResponse.json({ message: payload?.error?.message || "Unable to sign in." }, { status: upstream.status });
    const response = NextResponse.json({ user: payload.user });
    response.cookies.set("tlm_session", payload.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    return response;
  } catch { return NextResponse.json({ message: "Cannot reach the API. Check that the backend is running." }, { status: 502 }); }
}
