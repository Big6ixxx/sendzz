import { NextResponse } from "next/server";
import { cleanupExpiredOTPs } from "@/lib/twoFactor";

export async function POST(req: Request) {
  try {
    // Simple auth check - in production, use proper API key or cron secret
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

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
