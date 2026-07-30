/**
 * Didit KYC API Client
 *
 * A thin, typed wrapper around the Didit verification REST API.
 * https://docs.didit.me/api-reference/overview
 *
 * SECURITY: This module must ONLY be imported in server-side code
 * (API routes, server actions). The DIDIT_API_KEY must never be
 * exposed to the browser.
 */

const DIDIT_API_BASE = "https://verification.didit.me";
const DIDIT_API_VERSION = "v3";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiditSessionStatus =
  | "Not Started"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Abandoned";

export interface DiditSession {
  session_id: string;
  status: DiditSessionStatus;
  url: string;
  vendor_data?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DiditCreateSessionParams {
  /** Internal user identifier to associate with this session. */
  vendorData: string;
  /** Optional URL to redirect the user to after completion (frontend callback). */
  callback?: string;
}

export interface DiditCreateSessionResult {
  sessionId: string;
  sessionUrl: string;
  status: DiditSessionStatus;
}

// ─── Client ─────────────────────────────────────────────────────────────────

function getConfig(): { apiKey: string; workflowId: string } {
  const apiKey = process.env.DIDIT_API_KEY;
  const workflowId = process.env.DIDIT_WORKFLOW_ID;

  if (!apiKey) {
    throw new Error("[Didit] DIDIT_API_KEY is not set");
  }
  if (!workflowId) {
    throw new Error("[Didit] DIDIT_WORKFLOW_ID is not set");
  }

  return { apiKey, workflowId };
}

async function diditFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { apiKey } = getConfig();
  const url = `${DIDIT_API_BASE}/${DIDIT_API_VERSION}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable>");
    throw new Error(
      `[Didit] API error ${response.status} at ${path}: ${body}`,
    );
  }

  return response.json() as Promise<T>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Creates a new KYC verification session for the given user.
 *
 * @param params.vendorData - Your internal user ID (stored in Didit for webhook reconciliation)
 * @param params.callback - Optional URL Didit will redirect to after verification
 */
export async function createVerificationSession(
  params: DiditCreateSessionParams,
): Promise<DiditCreateSessionResult> {
  const { workflowId } = getConfig();

  const session = await diditFetch<DiditSession>("/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: workflowId,
      vendor_data: params.vendorData,
      ...(params.callback ? { callback: params.callback } : {}),
    }),
  });

  return {
    sessionId: session.session_id,
    sessionUrl: session.url,
    status: session.status,
  };
}

/**
 * Fetches the current status of an existing KYC session.
 */
export async function getSessionStatus(
  sessionId: string,
): Promise<DiditSessionStatus> {
  const session = await diditFetch<{ status?: DiditSessionStatus }>(
    `/session/${sessionId}/decision/`,
  );
  return session.status || "Not Started";
}

// ─── Webhook Utilities ───────────────────────────────────────────────────────

import crypto from "crypto";

/**
 * Verifies the HMAC-SHA256 signature of an incoming Didit webhook.
 *
 * Must be called on the RAW request body bytes before any JSON parsing.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @returns true if the signature is valid, false otherwise.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  receivedSignature: string,
): boolean {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Didit Webhook] DIDIT_WEBHOOK_SECRET is not set");
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  try {
    // timingSafeEqual requires same-length buffers
    const expectedBuf = Buffer.from(expected, "hex");
    const receivedBuf = Buffer.from(receivedSignature, "hex");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

/**
 * Validates that a webhook timestamp is within the allowed replay window.
 * @param timestamp - ISO 8601 timestamp from the X-Timestamp header or payload
 * @param maxAgeSeconds - Maximum allowed age in seconds (default: 300 = 5 minutes)
 */
export function isWebhookTimestampValid(
  timestamp: string,
  maxAgeSeconds = 300,
): boolean {
  const ts = new Date(timestamp).getTime();
  if (isNaN(ts)) return false;
  const ageMs = Date.now() - ts;
  return ageMs >= 0 && ageMs <= maxAgeSeconds * 1000;
}

/** Normalizes a Didit status string to our internal KycStatus enum. */
export function normalizeDiditStatus(
  diditStatus: string,
): "not_started" | "pending" | "in_review" | "approved" | "declined" {
  switch (diditStatus) {
    case "Approved":
      return "approved";
    case "Declined":
      return "declined";
    case "In Review":
      return "in_review";
    case "Abandoned":
      return "declined"; // treat abandoned as declined for limit enforcement
    case "Not Started":
    default:
      return "pending";
  }
}
