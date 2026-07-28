import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  verifyWebhookSignature,
  isWebhookTimestampValid,
  normalizeDiditStatus,
} from "@/lib/kyc/didit-client";
import {
  upsertKycVerification,
  getUserIdByVendorData,
  getUserIdBySessionId,
} from "@/lib/kyc/supabase-kyc";

export const runtime = "nodejs";

// ─── Types ──────────────────────────────────────────────────────────────────

interface DiditWebhookPayload {
  webhook_type: string;
  event_id: string;
  application_id?: string;
  timestamp?: string;
  data: {
    session_id: string;
    vendor_data?: string;
    status: string;
    reason?: string;
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

/**
 * POST /api/webhook/didit
 *
 * Receives and processes Didit KYC webhook events.
 *
 * Security:
 *   - Verifies HMAC-SHA256 signature on raw body using DIDIT_WEBHOOK_SECRET
 *   - Validates timestamp to prevent replay attacks (5-minute window)
 *   - Idempotent: safe to process the same event_id multiple times
 *
 * Configure this URL in the Didit Business Console → API & Webhooks.
 */
export async function POST(req: Request) {
  const requestId = crypto.randomBytes(4).toString("hex");

  try {
    // ── 1. Read raw body (must happen before any parsing) ─────────────────
    const rawBody = Buffer.from(await req.arrayBuffer());

    if (!rawBody.length) {
      console.error(`[Didit Webhook] [${requestId}] Empty body`);
      return new Response("Empty body", { status: 400 });
    }

    // ── 2. Verify HMAC signature ──────────────────────────────────────────
    const signature = req.headers.get("x-signature-v2") ?? "";

    if (!signature) {
      console.error(`[Didit Webhook] [${requestId}] Missing X-Signature-V2 header`);
      return new Response("Missing signature", { status: 401 });
    }

    const isValidSignature = verifyWebhookSignature(rawBody, signature);
    if (!isValidSignature) {
      console.error(`[Didit Webhook] [${requestId}] Invalid signature`);
      return new Response("Invalid signature", { status: 401 });
    }

    // ── 3. Validate timestamp (replay protection) ─────────────────────────
    const timestampHeader = req.headers.get("x-timestamp") ?? "";
    if (timestampHeader && !isWebhookTimestampValid(timestampHeader)) {
      console.warn(`[Didit Webhook] [${requestId}] Timestamp out of window: ${timestampHeader}`);
      return new Response("Timestamp out of acceptable window", { status: 400 });
    }

    // ── 4. Parse payload ──────────────────────────────────────────────────
    let payload: DiditWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf-8")) as DiditWebhookPayload;
    } catch {
      console.error(`[Didit Webhook] [${requestId}] Failed to parse JSON body`);
      return new Response("Invalid JSON", { status: 400 });
    }

    const { webhook_type, event_id, data } = payload;

    console.log(
      `[Didit Webhook] [${requestId}] Received event=${event_id} type=${webhook_type} session=${data?.session_id} status=${data?.status}`,
    );

    // ── 5. Route by event type ────────────────────────────────────────────
    if (webhook_type === "status.updated") {
      await handleStatusUpdated(requestId, payload);
    } else {
      // Unknown event type — acknowledge and ignore
      console.log(`[Didit Webhook] [${requestId}] Ignoring unknown event type: ${webhook_type}`);
    }

    // Always return 200 quickly to acknowledge receipt
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error(`[Didit Webhook] [${requestId}] Critical error:`, error);
    // Return 500 so Didit retries with exponential backoff
    return new Response("Internal error", { status: 500 });
  }
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

async function handleStatusUpdated(
  requestId: string,
  payload: DiditWebhookPayload,
): Promise<void> {
  const { data } = payload;
  const { session_id, vendor_data, status } = data;

  if (!session_id) {
    console.error(`[Didit Webhook] [${requestId}] Missing session_id in status.updated`);
    return;
  }

  // ── Resolve user ID ────────────────────────────────────────────────────
  // Primary: use vendor_data (= our user ID, set when creating the session)
  // Fallback: look up by session_id in case vendor_data is missing
  let userId: string | null = null;

  if (vendor_data) {
    userId = await getUserIdByVendorData(vendor_data);
  }

  if (!userId) {
    userId = await getUserIdBySessionId(session_id);
  }

  if (!userId) {
    console.error(
      `[Didit Webhook] [${requestId}] Could not resolve user for session=${session_id} vendor_data=${vendor_data}`,
    );
    return;
  }

  // ── Normalize and persist ──────────────────────────────────────────────
  const normalizedStatus = normalizeDiditStatus(status);

  await upsertKycVerification({
    userId,
    diditSessionId: session_id,
    vendorData: vendor_data ?? userId,
    status: normalizedStatus,
    webhookPayload: payload as unknown as Record<string, unknown>,
  });

  console.log(
    `[Didit Webhook] [${requestId}] Updated KYC status for user=${userId} ` +
      `session=${session_id} didit_status="${status}" → internal="${normalizedStatus}"`,
  );
}
