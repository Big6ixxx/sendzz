import { NextResponse, type NextRequest } from 'next/server';

/**
 * Outer gate for /admin.
 *
 * This is a cheap, network-free first filter, NOT the security boundary — it only checks that
 * a Privy session cookie is present, which a determined caller could fake. The real check is
 * `requireAdmin()` in lib/admin/auth.ts, which every admin server action runs and which
 * verifies the token with Privy and the email against `platform_admins`.
 *
 * What this buys: an anonymous visitor is bounced before the admin bundle, its layout, or any
 * server action is reached, so the console isn't even enumerable without signing in. Doing the
 * full verification here instead would put a Privy round-trip and a DB lookup on every admin
 * request, and would duplicate a rule that has to exist in the actions regardless — an action
 * is reachable directly, whether or not a page ever rendered.
 */
export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get('privy-token')?.value);

  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
