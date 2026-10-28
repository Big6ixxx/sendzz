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
  | "In Progress"
  | "In Review"
  | "Approved"
  | "Declined"
  | "Abandoned"
  | "Expired";

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

// ─── Session decisions ──────────────────────────────────────────────────────

import { TtlCache } from "@/lib/cache/ttl-cache";

type DiditCheck = {
  status?: string;
  warnings?: { short_description?: string | null; long_description?: string | null; risk?: string | null }[] | null;
};

/** The parts of a decision that carry warnings. */
const DECISION_FEATURES = [
  "id_verifications",
  "liveness_checks",
  "face_matches",
  "nfc_verifications",
  "poa_verifications",
  "database_validations",
  "phone_verifications",
  "email_verifications",
  "aml_screenings",
  "ip_analyses",
] as const;

/** A session's decision, as far as this module reads it. */
interface DiditDecision extends Partial<Record<(typeof DECISION_FEATURES)[number], DiditCheck[] | null>> {
  status?: DiditSessionStatus;
  vendor_data?: string | null;
  created_at?: string | null;
  id_verifications?: (DiditCheck & {
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    issuing_state?: string | null;
    date_of_birth?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    personal_number?: string | null;
    nationality?: string | null;
    verification_method?: string | null;
    id_lookup?: {
      source?: string | null;
      comparison?: { field?: string; record?: string | null }[] | null;
    } | null;
  })[] | null;
  reviews?: { comment?: string | null }[] | null;
}

/** Didit's session ids are UUIDs. Anything else is refused before it reaches a request path. */
export function isDiditSessionId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Approved decisions for ten seconds. One transition reads the same decision for its status,
 * its identity and its reasons; this makes that one Didit request instead of three, and reads
 * made at the same moment share the one in flight. Nothing else is kept once it lands: a
 * decision still in progress, or a decline a reviewer may yet reverse, served to the webhook
 * announcing the approval would judge it as no identity at all. Each webhook also forgets its
 * session first (forgetDecision), so a reviewer reversing an approval is seen too.
 */
const decisionCache = new TtlCache<DiditDecision>(10_000, 200);
const decisionsInFlight = new Map<string, Promise<DiditDecision>>();

async function getDecision(sessionId: string): Promise<DiditDecision> {
  if (!isDiditSessionId(sessionId)) throw new Error(`[Didit] not a session id: ${JSON.stringify(sessionId)}`);
  const hit = decisionCache.get(sessionId);
  if (hit) return hit;
  const pending = decisionsInFlight.get(sessionId);
  if (pending) return pending;
  const request = diditFetch<DiditDecision>(`/session/${sessionId}/decision/`)
    .then((decision) => {
      if (decision.status === "Approved") decisionCache.set(sessionId, decision);
      return decision;
    })
    .finally(() => decisionsInFlight.delete(sessionId));
  decisionsInFlight.set(sessionId, request);
  return request;
}

/** Drop a session's cached decision: Didit has just said it changed. */
export function forgetDecision(sessionId: string): void {
  decisionCache.delete(sessionId);
  decisionsInFlight.delete(sessionId);
}

/** The name and document country Didit verified for a session. */
export interface DiditVerifiedIdentity {
  firstName: string;
  lastName: string;
  /** ISO 3166-1 alpha-3 code of the state that issued the document, e.g. "NGA". */
  issuingState: string;
  /** The name as printed on the document, when Didit read one; otherwise first + last. */
  fullName: string;
  /** YYYY-MM-DD, when the document gave one. */
  dateOfBirth?: string;
  /** Didit's label for the document, e.g. "Passport", "Identity Card". */
  documentType?: string;
  documentNumber?: string;
  /** A second number some documents carry — on a Nigerian passport, the holder's NIN. */
  personalNumber?: string;
  /** ISO 3166-1 alpha-3. */
  nationality?: string;
  /**
   * Set when the user was verified by a registry lookup instead of a document (Didit's
   * Nigeria NIN/BVN lookup): the register queried, and the number it matched.
   */
  lookup?: { source?: string; identifier?: string };
}

/**
 * The verified identity behind an approved session, or null when the session is not approved
 * or its document check carries no name.
 */
export async function getVerifiedIdentity(
  sessionId: string,
): Promise<DiditVerifiedIdentity | null> {
  const decision = await getDecision(sessionId);
  if (decision.status !== "Approved") return null;
  // The session's decision is the verdict. A reviewer approving a session can leave its ID
  // check reading "In Review", so any ID check not declined is taken, an approved one first.
  const checks = decision.id_verifications ?? [];
  const id =
    checks.find((v) => v.status === "Approved") ??
    checks.find((v) => v.status !== "Declined" && v.first_name?.trim() && v.last_name?.trim());
  const firstName = id?.first_name?.trim();
  const lastName = id?.last_name?.trim();
  const issuingState = id?.issuing_state?.trim().toUpperCase();
  if (!id || !firstName || !lastName || !issuingState) return null;
  const text = (v?: string | null) => v?.trim() || undefined;
  const lookup =
    id.verification_method === "id_lookup" && id.id_lookup
      ? {
          source: text(id.id_lookup.source),
          identifier: text(id.id_lookup.comparison?.find((c) => c.field === "identification_number")?.record),
        }
      : undefined;
  return {
    firstName,
    lastName,
    issuingState,
    fullName: (text(id.full_name) ?? `${firstName} ${lastName}`).replace(/\s+/g, " "),
    dateOfBirth: text(id.date_of_birth),
    documentType: text(id.document_type),
    documentNumber: text(id.document_number),
    personalNumber: text(id.personal_number),
    nationality: text(id.nationality)?.toUpperCase(),
    ...(lookup ? { lookup } : {}),
  };
}

/** One reason Didit gave for not approving a session on its own. */
export interface DiditDecisionReason {
  /** e.g. "Printed copy of document detected". */
  title: string;
  /** Didit's longer explanation, when it gives one. */
  detail?: string;
}

/**
 * The checks about the user's own document and face. Their warnings are safe, and useful, to
 * show the user: they say what to fix.
 */
const USER_FACING_FEATURES = ["id_verifications", "liveness_checks", "face_matches", "nfc_verifications"] as const;

/**
 * Why Didit did not approve this session by itself: the warnings on every check that did not
 * pass, plus any comment a reviewer left. The reason a session went to review is nearly always
 * the reason it is declined, so the admins and the user see the same reasons, with one limit:
 * the user sees only the document and face checks. AML screening, IP and other risk signals
 * stay with the admins, since telling someone they matched a watchlist, or which signal to
 * dodge, defeats the check. Empty when Didit gave none; never throws.
 */
export async function getDecisionReasons(
  sessionId: string,
  audience: "admin" | "user",
): Promise<DiditDecisionReason[]> {
  try {
    const decision = await getDecision(sessionId);
    const reasons: DiditDecisionReason[] = [];
    const seen = new Set<string>();
    for (const feature of audience === "user" ? USER_FACING_FEATURES : DECISION_FEATURES) {
      for (const check of decision[feature] ?? []) {
        if (check.status === "Approved") continue;
        for (const w of check.warnings ?? []) {
          const title = (w.short_description || w.risk || "").trim();
          if (!title || seen.has(title)) continue;
          seen.add(title);
          reasons.push({ title, detail: w.long_description?.trim() || undefined });
        }
      }
    }
    for (const review of decision.reviews ?? []) {
      const comment = review.comment?.trim();
      if (comment && !seen.has(comment)) {
        seen.add(comment);
        reasons.push({ title: "Reviewer's note", detail: comment });
      }
    }
    return reasons;
  } catch (err) {
    console.warn(`[Didit] could not read decision reasons for ${sessionId}:`, (err as Error).message);
    return [];
  }
}

/** A session of this user's started after the one on record: a re-verification. */
export interface NewerSession {
  sessionId: string;
  status: DiditSessionStatus;
  /** Where the user continues it, while it can still be continued. */
  url: string | null;
}

/**
 * This user's sessions started after `after` (the session on record), newest first. A
 * re-verification is not on the record until approved, so this is how one waiting for a
 * reviewer, or one started and not finished, is found. Follows the list's pages, a few at most.
 */
export async function newerSessions(userId: string, after: string): Promise<NewerSession[]> {
  const since = Date.parse((await getSessionState(after)).createdAt ?? "");
  if (!Number.isFinite(since)) return [];
  type Page = {
    next?: string | null;
    results?: { session_id: string; status?: DiditSessionStatus; created_at?: string; session_url?: string | null }[];
  };
  const found: NewerSession[] = [];
  let path: string | null = `/sessions/?vendor_data=${encodeURIComponent(userId)}`;
  for (let page = 0; path && page < 5; page++) {
    const list: Page = await diditFetch<Page>(path);
    for (const s of list.results ?? []) {
      if (s.session_id !== after && Date.parse(s.created_at ?? "") > since) {
        found.push({ sessionId: s.session_id, status: s.status ?? "Not Started", url: s.session_url ?? null });
      }
    }
    // `next` is a full URL; diditFetch takes the path after the versioned base.
    const prefix = `${DIDIT_API_BASE}/${DIDIT_API_VERSION}`;
    path = list.next ? (list.next.startsWith(prefix) ? list.next.slice(prefix.length) : null) : null;
  }
  return found;
}

/**
 * Fetches the current status of an existing KYC session.
 */
export async function getSessionStatus(
  sessionId: string,
): Promise<DiditSessionStatus> {
  return (await getSessionState(sessionId)).status;
}

/** A session's status, the `vendor_data` (our user id) it was created with, and when. */
export async function getSessionState(
  sessionId: string,
): Promise<{ status: DiditSessionStatus; vendorData: string | null; createdAt: string | null }> {
  const session = await getDecision(sessionId);
  return {
    status: session.status || "Not Started",
    vendorData: session.vendor_data ?? null,
    createdAt: session.created_at ?? null,
  };
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
    case "Expired":
      return "declined"; // ended unfinished: treated as declined for limit enforcement
    case "Not Started":
    case "In Progress":
    default:
      return "pending";
  }
}

/**
 * Deep link to one verification session in the Didit business console, for admin review.
 *
 * The console is a separate product from the verification API this module wraps, and its URL
 * shape isn't part of the API contract, and the two path UUIDs are our organisation and
 * project — so the whole thing is a template. Override it with `DIDIT_CONSOLE_SESSION_URL`
 * (any string containing `{sessionId}`) to point a different environment at a different Didit
 * workspace without a code change.
 *
 * Server-side only, like the rest of this module: the resolved URL is handed to the client by
 * the admin server action, so nothing here reaches the browser.
 */
const DIDIT_CONSOLE_ORG_ID = "07e3f741-4d4f-4258-8f89-f3b17e96c9b2";
const DIDIT_CONSOLE_PROJECT_ID = "df085f7d-9abb-4cc6-b7a5-076e4696742e";

export function diditConsoleSessionUrl(sessionId: string): string {
  const template =
    process.env.DIDIT_CONSOLE_SESSION_URL ||
    `https://business.didit.me/console/${DIDIT_CONSOLE_ORG_ID}/${DIDIT_CONSOLE_PROJECT_ID}` +
      `/kyc/verifications?session-id={sessionId}#OVERVIEW`;
  return template.replace("{sessionId}", encodeURIComponent(sessionId));
}
