import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { Role } from "@/lib/roles";

/**
 * The optimiztic auth check in front of every route.
 *
 * Next 16 renamed `middleware` to `proxy` and runs it on the Node runtime by
 * default — a `runtime` export here throws, so v1's `export const runtime =
 * 'nodejs'` is dropped rather than carried over.
 *
 * Per next/docs "Proxy", this is a redirect layer, not the authorization
 * boundary: `(shell)/layout.tsx` re-checks the session server-side, and every
 * server action still gates on requireAuth/requireEditor. This exists so an
 * anonymous request never renders the shell at all.
 */

/** Reachable without a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/setup-account",
  // The client-facing quote portal and its API, which authenticate by token.
  "/quote",
  "/api/quote",
  "/requirements",
  "/api/requirements",
];

/** Authenticated by key or cron secret, not by session cookie. */
const KEYED_PREFIXES = ["/api/auth", "/api/v1", "/api/cron"];

const STATIC = /^\/_next\/|^\/favicon|\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot)$/;

function startsWithAny(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (STATIC.test(pathname) || startsWithAny(pathname, KEYED_PREFIXES)) {
    return NextResponse.next();
  }

  const isPublic = startsWithAny(pathname, PUBLIC_PREFIXES);
  const signedIn = !!req.auth;
  const role = req.auth?.user?.role as Role | undefined;

  // Flow is not part of v2 — the task area was dropped along with the rail
  // entry, so a FLOW_USER has no destination here. Say so on a dedicated page
  // rather than bouncing them to /login, which would loop: they *are* signed in.
  if (signedIn && role === "FLOW_USER" && pathname !== "/no-access") {
    return NextResponse.redirect(new URL("/no-access", req.nextUrl));
  }

  if (isPublic) {
    // A signed-in user has no business on the login screen.
    if (signedIn && pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    const login = new URL("/login", req.nextUrl);
    // Come back to where they were headed once they're through.
    login.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
