import "server-only";
import { supabaseAdmin } from "@/lib/supabase/adminClient";

/**
 * Paycrest refunding a withdrawal settles what we owed for it.
 *
 * Every Paycrest order is created with the user's own wallet as its `refundAddress`, so when
 * Paycrest reports `refunded` the USDC is already back with the user. Leaving `refund_tx_hash`
 * empty kept it in the refund queue, asking an operator to pay it a second time.
 *
 * Paycrest only. Other providers may refund to an account of ours rather than to the user, in
 * which case the debt is still ours to pay; their `refunded` is left for an operator.
 *
 * Callers must already trust the status: a signed webhook, or a status fetched server-side.
 */

/** Paycrest's refund transaction, when the order's log carries one. */
export function paycrestRefundHash(order: unknown): string | null {
  const o = order as { transactions?: unknown; transactionLogs?: unknown } | null;
  const logs = [o?.transactions, o?.transactionLogs].find(Array.isArray) as
    | { status?: unknown; txHash?: unknown }[]
    | undefined;
  const entry = logs?.find(
    (t) =>
      typeof t?.status === "string" &&
      t.status.toLowerCase().includes("refund") &&
      typeof t.txHash === "string" &&
      t.txHash.length > 0,
  );
  return (entry?.txHash as string | undefined) ?? null;
}

/**
 * Record a Paycrest refund against its withdrawal. Idempotent: a repeat delivery, or the webhook
 * and polling both arriving, settles once.
 *
 * With no hash from Paycrest the evidence recorded is `paycrest-refund:<order>` — the provider's
 * own terminal status, named as such rather than passed off as a transaction.
 */
export async function recordPaycrestRefund(
  orderId: string,
  refundTxHash: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // Records what is owed first. A no-op for a row already failed or reversed.
  const { error: failError } = await supabaseAdmin.rpc("finalize_withdrawal_failed", {
    p_paycrest_order_id: orderId,
    p_reason: "Paycrest refunded the deposit to the user's wallet",
  });
  if (failError) return { ok: false, error: failError.message };

  const { data: w, error: readError } = await supabaseAdmin
    .from("withdrawals")
    .select("id, refund_owed_usdc, refund_tx_hash")
    .eq("provider_order_id", orderId)
    .maybeSingle();
  if (readError || !w) return { ok: false, error: readError?.message ?? "withdrawal not found" };
  if (w.refund_tx_hash) return { ok: true };

  // Nothing left the wallet, so nothing was owed and there is no debt to settle.
  if (w.refund_owed_usdc == null) {
    const { error } = await supabaseAdmin
      .from("withdrawals")
      .update({ status: "reversed" })
      .eq("id", w.id);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabaseAdmin.rpc("finalize_withdrawal_refunded", {
    p_withdrawal_id: w.id,
    p_refund_tx_hash: refundTxHash ?? `paycrest-refund:${orderId}`,
  });
  if (error) return { ok: false, error: error.message };

  console.log(`[Refund] ${orderId}: refunded by Paycrest — settled (${refundTxHash ?? "no hash given"})`);
  return { ok: true };
}
