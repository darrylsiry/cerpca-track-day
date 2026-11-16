import { NextResponse, type NextRequest } from "next/server";

/*
 * Optimistic gate only: it checks that a session cookie exists so signed-out
 * visitors go straight to the sign-in screen. The real check (is the session
 * valid, what may this person see) happens in src/server/auth.ts on every read
 * and every Server Action.
 */
const PUBLIC = [/^\/login(\/|$)/, /^\/tech\//, /^\/api\/cron\//, /^\/manifest\.webmanifest$/];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = request.cookies.has("td_session");

  if (pathname === "/") {
    return NextResponse.redirect(new URL(signedIn ? "/home" : "/login", request.url));
  }
  if (!signedIn && !PUBLIC.some((re) => re.test(pathname))) {
    const url = new URL("/login", request.url);
    if (pathname !== "/home") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|tracks/|sw\\.js|favicon\\.ico|icon|apple-icon|.*\\.(?:png|jpg|jpeg|svg|webp|ico|pdf)$).*)"],
};
