import { requireUser } from '@/lib/auth/session';
import { redactEmail } from '@/lib/log';
import { NextResponse } from 'next/server';

/**
 * POST /api/client-error
 *
 * Transfers, withdrawals and bridge claims run in the browser, so their failures used to land
 * only in the user's own console and never in the server log. The error toast reports here
 * (lib/errors/report.ts) and this writes one line — who, which page, what failed — that sits
 * next to the server's own lines for the same request.
 */
const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

export async function POST(req: Request) {
  let email: string;
  try {
    ({ email } = await requireUser());
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const message = clean(body.message, 600);
  if (!message) return new NextResponse(null, { status: 204 });

  const shown = clean(body.shown, 200);
  const at = clean(body.at, 300);
  console.error(
    `[Client] ${redactEmail(email)} on ${clean(body.page, 100) || '?'}: ${message}` +
      (shown && shown !== message ? ` (user saw: "${shown}")` : '') +
      (at ? ` [at ${at}]` : ''),
  );
  return new NextResponse(null, { status: 204 });
}
