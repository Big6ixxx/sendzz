import { toast } from "sonner";

/**
 * Record a CCTP burn against the user's account.
 *
 * The burn is irreversible by the time this runs, and a burn with no row is invisible
 * everywhere: it appears in no balance and on no claim screen, so the USDC is stranded with
 * nothing pointing at it. That is not a hypothetical — a 10.71 USDC burn from Base to Stellar
 * was lost exactly this way, recoverable only by reading it back off chain.
 *
 * Two things follow from that, and they are why this is a function rather than four inline
 * fetches:
 *
 *   `keepalive` — the browser still delivers the request if the tab is closed or navigated away
 *   the instant after signing, which is the window the lost burn fell through.
 *
 *   A visible failure — the call used to end in `.catch(console.error)`, so the one signal that
 *   money needed manual recovery went to a console nobody was reading. If this cannot be
 *   recorded, the user is told, and given the hash to quote.
 */
export async function recordBurn(params: {
  userEmail: string;
  sourceChain: string;
  destChain: string;
  amountUsdc: number;
  burnTxHash: string;
}): Promise<void> {
  const { burnTxHash } = params;
  try {
    const res = await fetch("/api/bridge/record", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`record responded ${res.status}`);
  } catch (err) {
    console.error("[Bridge] FAILED to record burn", burnTxHash, err);
    toast.error(
      "Your transfer went through but we could not record it. Save this reference and " +
        `contact support: ${burnTxHash}`,
      { duration: 30000 },
    );
  }
}

/**
 * Hold a consolidation burn until its funds are delivered.
 *
 * A bridge that only funds a withdrawal is not something the user chose to do, so it must not
 * become history — see `consolidation_claims`. But the burn is irreversible and a burn nobody
 * knows about is USDC that shows in no balance and on no claim screen, so it is written here
 * the moment it lands and cleared by `clearConsolidationBurn` once the funds arrive.
 *
 * Never throws. Aborting after a burn has already happened only makes the situation worse.
 */
export async function recordConsolidationBurn(params: {
  burnTxHash: string;
  sourceChain: string;
  destChain: string;
  amountUsdc: string | number;
}): Promise<void> {
  try {
    // `keepalive` so it still lands if the tab is closed in the seconds after signing.
    await fetch("/api/bridge/consolidation", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  } catch (err) {
    console.error(
      "[Bridge] could not record consolidation burn",
      params.burnTxHash,
      err,
    );
  }
}

/** Delivered — drop the scratch row so a completed withdrawal leaves no trace behind it. */
export async function clearConsolidationBurn(burnTxHash: string): Promise<void> {
  try {
    await fetch(
      `/api/bridge/consolidation?burnTxHash=${encodeURIComponent(burnTxHash)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    console.warn("[Bridge] could not clear consolidation claim", burnTxHash, err);
  }
}
