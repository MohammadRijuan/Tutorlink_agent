import { NextRequest, NextResponse } from "next/server";

/**
 * Fast gate: checks that a session cookie exists and has not expired, with NO network call.
 * (The previous version called the API and database on every page navigation, which made every click wait for a serverless round trip.)
 * The API still verifies the token on every data request and the dashboard redirects to sign-in on a 401, so this is not the security boundary.
 */
function sessionLooksValid(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 > Date.now() : true;
  } catch { return false; }
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get("tlm_session")?.value;
  const isLogin = request.nextUrl.pathname === "/login";
  const valid = token ? sessionLooksValid(token) : false;
  if (!valid && !isLogin) {
    const url = new URL("/login", request.url); url.searchParams.set("next", request.nextUrl.pathname);
    const redirect = NextResponse.redirect(url);
    if (token) redirect.cookies.delete("tlm_session");
    return redirect;
  }
  if (valid && isLogin) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
