"use server";

/**
 * KYC Supabase Data Access Layer
 *
 * All database operations for KYC verification records.
 * Uses the admin (service-role) client so RLS does not block server mutations.
 */

import { supabaseAdmin } from "@/lib/supabase/adminClient";
import type { Database, Json } from "@/types/database";
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
