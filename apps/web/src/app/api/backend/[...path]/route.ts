import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// The agent campaign (AI + rendering + Meta upload) can take over a minute; allow the maximum Vercel permits.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const session = (await cookies()).get("tlm_session")?.value;
  if (!session) return NextResponse.json({ error: { message: "Sign in is required." } }, { status: 401 });
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = `${(process.env.API_BASE_URL || "http://localhost:4000").replace(/\/$/, "")}/api/v1/${path.map(encodeURIComponent).join("/")}${incoming.search}`;
  const headers = new Headers({ authorization: `Bearer ${session}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  let body: string | undefined;
  if (!['GET', 'HEAD'].includes(request.method)) body = await request.text();
  try {
    const upstream = await fetch(target, { method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(285000) });
    if (upstream.status === 204) return new NextResponse(null, { status: 204 });
    const payload = await upstream.text();
    return new NextResponse(payload, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json({ error: { message: "The backend request timed out. The AI service may be taking longer than expected; please retry." } }, { status: 504 });
    }
    return NextResponse.json({ error: { message: "API is unavailable. Confirm the backend is running." } }, { status: 502 });
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
