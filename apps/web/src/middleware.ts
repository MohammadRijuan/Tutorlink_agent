import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get("tlm_session")?.value;
  const isLogin = request.nextUrl.pathname === "/login";
  if (!token && !isLogin) {
    const url = new URL("/login", request.url); url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (token && isLogin) return NextResponse.redirect(new URL("/", request.url));
  if (token && !isLogin) {
    const apiBase = process.env.API_BASE_URL || "http://localhost:4000";
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) {
        const url = new URL("/login", request.url); url.searchParams.set("next", request.nextUrl.pathname);
        const redirect = NextResponse.redirect(url); redirect.cookies.delete("tlm_session"); return redirect;
      }
    } catch {
      return new NextResponse("Authentication service unavailable. Please try again shortly.", { status: 503 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
