import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/adminClient";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Clear TOTP data
    const { error } = await supabaseAdmin
      .from("user_profiles")
      .update({
        totp_secret: null,
        totp_enabled: false,
        totp_verified_at: null,
      })
      .eq("email", email);

    if (error) {
      console.error("Failed to disable TOTP:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
