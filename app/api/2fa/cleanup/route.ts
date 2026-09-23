import { NextResponse } from "next/server";
import { rejectUnauthorizedCron } from "@/lib/auth/cron";
import { cleanupExpiredOTPs } from "@/lib/twoFactor";

export async function POST(req: Request) {
  try {
    // Uses the shared cron gate, which fails CLOSED.
    //
    // This used to read `if (cronSecret && header !== ...)`, so a deployment with no
    // CRON_SECRET skipped the comparison and served everybody — while looking perfectly
    // healthy. That is the precise bug lib/auth/cron.ts was written to end, and this route
    // had its own copy of it.
    const unauthorized = rejectUnauthorizedCron(req);
    if (unauthorized) return unauthorized;

    await cleanupExpiredOTPs();

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("[2FA Cleanup] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to cleanup expired OTPs";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 },
    );
  }
}
