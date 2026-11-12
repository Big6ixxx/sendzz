/**
 * POST /api/session/clear: drop this browser's Privy cookies.
 *
 * For the dashboard's "Sign in again" escape (app/dashboard/layout.tsx), used when Privy is
 * stuck restoring a session and cannot sign out itself. The page clears what it can reach, but
 * with Privy's HttpOnly cookies on, script cannot see `privy-token` at all, and leaving it
 * would put the user straight back into the session they were escaping. A response can expire
 * it.
 *
 * No session check, on purpose: it only removes the caller's own cookies, the same as signing
 * out, and a session too broken to sign out is exactly the one it exists for.
 *
 * It must still refuse other sites. A plain form posted from anywhere would otherwise sign
 * people out at will. So the request has to carry `x-sendzz-clear`: a cross-site form cannot
 * send a custom header, and a cross-site script can only send one after a CORS preflight this
 * route never approves, so the request is never made. `Sec-Fetch-Site`, where the browser sends
 * it, is checked as well. Not the Origin against the Host: behind a proxy the host this server
 * sees can differ from the one the browser used, and a refusal here would quietly leave the
 * user in the session they were escaping.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PRIVY_COOKIES = ['privy-token', 'privy-session', 'privy-id-token', 'privy-refresh-token'];

export async function POST(req: Request) {
  if (req.headers.get('x-sendzz-clear') !== '1') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // The first host the request was addressed to, for the parent domains below.
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim();

  const res = NextResponse.json({ ok: true });
  // Expired once without a Domain (a cookie set for this host only) and once for each parent
  // domain of this host: a cookie Privy set on `.sendzz.com` survives a delete that does not
  // name that domain. Browsers ignore a Domain that is not this host or one of its parents.
  const hostname = host.split(':')[0];
  const labels = hostname.split('.');
  const domains = [
    undefined,
    ...labels.slice(0, -1).map((_, i) => labels.slice(i).join('.')).filter((d) => d.includes('.')),
  ];
  for (const name of PRIVY_COOKIES) {
    for (const domain of domains) {
      res.headers.append(
        'Set-Cookie',
        `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=Lax` +
          (domain ? `; Domain=${domain}` : ''),
      );
    }
  }
  return res;
}
