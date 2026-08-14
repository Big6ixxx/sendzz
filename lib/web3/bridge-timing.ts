/**
 * Handoff timing between the two things that can finish a bridge.
 *
 * A burn is watched by exactly one actor at a time:
 *   0 → HANDOFF        the in-page monitor (ChainBridgeModule / SmartBridgeModule) polls for
 *                      the attestation and claims automatically while the user is on the page
 *   HANDOFF → ∞        the Pending Claims panel takes over, so a transfer still finishes if
 *                      the user navigated away or closed the tab
 *
 * These MUST stay equal. Shorter monitor than handoff leaves a dead window where neither is
 * acting; longer leaves both acting on the same burn, which is what made a Claim button appear
 * next to a bridge the monitor was still mid-way through delivering.
 *
 * They were two hardcoded numbers in four files, and drifted — hence this module. Change the
 * window here and every loop and query follows.
 */

/** How often each in-page monitor polls Circle for the attestation. */
export const MONITOR_POLL_MS = 5_000;

/** When the in-page monitor hands a burn over to the Pending Claims panel. */
export const CLAIM_HANDOFF_MS = 5 * 60 * 1000;

/** Poll budget derived from the window above — never hardcode this. */
export const MONITOR_MAX_ATTEMPTS = CLAIM_HANDOFF_MS / MONITOR_POLL_MS;
