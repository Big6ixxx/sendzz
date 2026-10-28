/**
 * KYC Supabase Data Access Layer. SERVER ONLY, and deliberately NOT a server action.
 *
 * Uses the admin (service-role) client so RLS does not block server mutations.
 *
 * --- Why the `'use server'` came off ------------------------------------------
 *
 * With it, all five exports were POST endpoints anyone could invoke once they knew an action
 * id — including `upsertKycVerification({ userId, status })`, which sets the verification
 * state that governs how much a user may withdraw before verifying. Setting somebody to
 * `approved` from outside is not an information leak, it is lifting a compliance control.
 *
 * Nothing needed it to be an action. Every caller is server-side already: the Didit webhook
 * (signature-verified), the KYC API routes, and the withdrawal guard in lib/kyc/guard.ts.
 * Removing the directive makes the whole module unreachable from a browser, which is the
 * strongest form of the fix — there is no endpoint left to authenticate.
 *
 * The `userId` arguments below are therefore internal plumbing, not caller-supplied identity.
 * The routes that reach them still have to resolve identity themselves.
 */

import { supabaseAdmin } from "@/lib/supabase/adminClient";
import type { Database, Json } from "@/types/database";
import { guardedUpdate } from "@/lib/supabase/guarded-update";
import {
  UNVERIFIED_ALLOWANCE_START,
  UNVERIFIED_WITHDRAWAL_ALLOWANCE,
} from "./limits";

// ─── Types ──────────────────────────────────────────────────────────────────

export type KycStatus =
  | "not_started"
  | "pending"
  | "in_review"
  | "approved"
  | "declined";

export interface KycVerification {
  userId: string;
  diditSessionId: string | null;
  status: KycStatus;
  updatedAt: string;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * How much the user has already withdrawn against their unverified allowance.
 *
 * Returns the allowance as fully spent if the lookup fails. Defaulting to zero would hand a
 * fresh 100 to everyone the moment the database hiccuped, which is the one wrong answer here.
 */
export async function getWithdrawnAgainstAllowance(
  userId: string,
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    "get_unverified_withdrawal_total",
    { p_user_id: userId, p_since: UNVERIFIED_ALLOWANCE_START },
  );

  if (error) {
    console.error(
      "[KYC] Failed to read withdrawal total against allowance:",
      error.message,
    );
    return UNVERIFIED_WITHDRAWAL_ALLOWANCE;
  }

  return Number(data ?? 0);
}

/** The user's KYC verification record, or a `not_started` default. */
export async function getUserKycStatus(
  userId: string,
): Promise<KycVerification> {
  const { data, error } = await supabaseAdmin
    .from("kyc_verifications")
    .select("user_id, didit_session_id, status, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[KYC] Failed to fetch KYC status:", error);
    return {
      userId,
      diditSessionId: null,
      status: "not_started",
      updatedAt: new Date().toISOString(),
    };
  }

  if (!data) {
    return {
      userId,
      diditSessionId: null,
      status: "not_started",
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    userId: data.user_id,
    diditSessionId: data.didit_session_id,
    status: data.status as KycStatus,
    updatedAt: data.updated_at,
  };
}

/**
 * Creates or updates the KYC verification record for a user.
 * Safe to call multiple times — uses upsert with conflict on user_id.
 */
export async function upsertKycVerification(params: {
  userId: string;
  diditSessionId?: string;
  vendorData?: string;
  status: KycStatus;
  webhookPayload?: Record<string, unknown>;
}): Promise<void> {
  const row: Database["public"]["Tables"]["kyc_verifications"]["Insert"] = {
    user_id: params.userId,
    status: params.status,
    updated_at: new Date().toISOString(),
  };

  if (params.diditSessionId) row.didit_session_id = params.diditSessionId;
  if (params.vendorData) row.vendor_data = params.vendorData;
  if (params.webhookPayload) row.last_webhook_payload = params.webhookPayload as Json;

  const { error } = await supabaseAdmin
    .from("kyc_verifications")
    .upsert(row, {
      onConflict: "user_id",
      ignoreDuplicates: false,
    });

  if (error) {
    console.error("[KYC] Failed to upsert KYC verification:", error.message);
    if (error.message.includes("foreign key constraint") || error.code === "23503") {
      console.warn("[KYC] Foreign key constraint on kyc_verifications. Proceeding with session.");
      return;
    }
    throw new Error(`KYC upsert failed: ${error.message}`);
  }
}

/**
 * Looks up a user ID by their Didit vendor_data field.
 * Used in webhook handlers when matching on vendor_data.
 */
export async function getUserIdByVendorData(
  vendorData: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("kyc_verifications")
    .select("user_id")
    .eq("vendor_data", vendorData)
    .maybeSingle();

  if (error || !data) return null;
  return data.user_id;
}

/**
 * Looks up a user ID by their Didit session ID.
 * Fallback for webhook handlers when vendor_data is missing.
 */
export async function getUserIdBySessionId(
  sessionId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("kyc_verifications")
    .select("user_id")
    .eq("didit_session_id", sessionId)
    .maybeSingle();

  if (error || !data) return null;
  return data.user_id;
}

/** The re-verification notices already announced (claimReverifyNotice): the last NOTICES_KEPT. */
const NOTICES_KEPT = 20;

function noticesIn(payload: unknown): string[] {
  const list = (payload as { reverify_notices?: unknown } | null)?.reverify_notices;
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : [];
}

/**
 * Record a session's status, and say whether this call is the one that changed it.
 *
 * The Didit webhook and the status endpoint's live sync can both see the same transition at the
 * same moment. Each sends the outcome email only when this returns true, and the write is
 * guarded (guardedUpdate), so exactly one of them does. The same guard keeps the
 * re-verification notices stored beside the webhook payload (claimReverifyNotice) from being
 * overwritten by a payload read before they were added.
 */
export async function recordKycTransition(params: {
  userId: string;
  diditSessionId: string;
  status: KycStatus;
  vendorData?: string;
  webhookPayload?: Record<string, unknown>;
}): Promise<boolean> {
  const build = (notices: string[]): Database["public"]["Tables"]["kyc_verifications"]["Update"] => ({
    didit_session_id: params.diditSessionId,
    status: params.status,
    updated_at: new Date().toISOString(),
    ...(params.vendorData ? { vendor_data: params.vendorData } : {}),
    ...(params.webhookPayload
      ? { last_webhook_payload: { ...params.webhookPayload, ...(notices.length ? { reverify_notices: notices } : {}) } as Json }
      : {}),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await guardedUpdate({
      table: "kyc_verifications",
      match: { column: "user_id", value: params.userId },
      change: (row) =>
        row.didit_session_id === params.diditSessionId && row.status === params.status
          ? null
          : build(noticesIn(row.last_webhook_payload)),
    });
    if (result !== "missing") return result === "written";

    const { error } = await supabaseAdmin
      .from("kyc_verifications")
      .insert({ user_id: params.userId, ...build([]) });
    if (!error) return true;
    // A concurrent first record won: go round once more and judge against it.
    if (error.code !== "23505") throw new Error(`KYC transition failed: ${error.message}`);
  }
  return false;
}

/**
 * Claim the one announcement of a re-verification outcome that is not on the record (its
 * review, its decline, or its approval being refused). True for the first caller with this
 * `key` (session and outcome), false for every redelivery after it, in whatever order they come.
 *
 * A re-verification is recorded only once it replaces the approved session, so its other
 * outcomes cannot be deduplicated by recordKycTransition. The announced keys are kept on the
 * user's record instead, beside the webhook payload, through the same guarded write. Throws on a
 * database error, so the webhook fails and Didit redelivers, rather than the announcement being
 * silently skipped.
 */
export async function claimReverifyNotice(userId: string, key: string): Promise<boolean> {
  const result = await guardedUpdate({
    table: "kyc_verifications",
    match: { column: "user_id", value: userId },
    change: (row) => {
      const payload =
        row.last_webhook_payload && typeof row.last_webhook_payload === "object" && !Array.isArray(row.last_webhook_payload)
          ? (row.last_webhook_payload as Record<string, Json>)
          : {};
      const notices = noticesIn(payload);
      if (notices.includes(key)) return null;
      return {
        last_webhook_payload: { ...payload, reverify_notices: [...notices, key].slice(-NOTICES_KEPT) },
        updated_at: new Date().toISOString(),
      };
    },
  });
  return result === "written";
}

/**
 * Mark the user's verification as started: `not_started` becomes `pending`, and nothing else
 * changes. One conditional update, so it cannot overwrite a status the webhook recorded between
 * a read and this write (an `in_review` put back to `pending` would be recorded, and announced,
 * a second time).
 */
export async function markKycStarted(userId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("kyc_verifications")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "not_started");
  if (error) throw new Error(`KYC start failed: ${error.message}`);
}
