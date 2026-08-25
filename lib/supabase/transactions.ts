"use server";

import { Database } from "@/types/database";
import { redactEmail } from "@/lib/log";
import { supabaseAdmin } from "./adminClient";
import { fetchAttestation, type SupportedChain } from "@/lib/circle/gateway";
import { fetchSolanaAttestation } from "@/lib/circle/solana-gateway";
import { fetchStellarAttestation } from "@/lib/circle/stellar-gateway";
import { requireUser } from "@/lib/auth/session";
import type { PendingBridgeClaim } from "@/types/bridge";
import { isPlaceholderHash, PLACEHOLDER_TX_HASH } from "@/lib/explorers";

type ExtendedChain = SupportedChain | "solana" | "stellar";

async function getAttestation(sourceChain: ExtendedChain, txHash: string) {
  if (sourceChain === "solana") {
    return fetchSolanaAttestation(txHash);
  }
  if (sourceChain === "stellar") {
    return fetchStellarAttestation(txHash);
  }
  return fetchAttestation(sourceChain as SupportedChain, txHash);
}

type TransferRow = Database["public"]["Tables"]["transfers"]["Row"];

/**
 * Last-resort lookup of the transaction that minted a bridge on its destination chain.
 *
 * Best-effort by design: it runs on the notification path, so a slow or unhelpful RPC
 * must never stop the email going out. EVM destinations only.
 */
async function recoverMintTxHash(
  sourceChain: string,
  destChain: string,
  burnTxHash: string,
): Promise<string | undefined> {
  try {
    const attestation = await getAttestation(
      sourceChain as ExtendedChain,
      burnTxHash,
    );
    if (!attestation.messageBytes) return undefined;
    return await findEvmMintTxHash(destChain, attestation.messageBytes);
  } catch (err) {
    console.error("[recoverMintTxHash] Lookup failed:", (err as Error).message);
    return undefined;
  }
}

// --- TRANSFERS ---

export async function recordTransfer(params: {
  senderEmail: string;
  recipientEmail: string;
  amount: number;
  status: "completed" | "pending_claim";
  note?: string;
  txHash?: string;
  /** Network the transfer settled on (e.g. 'base', 'polygon'). Optional. */
  chain?: string;
}): Promise<void> {
  try {
    const senderEmail = params.senderEmail.toLowerCase();
    const recipientEmail = params.recipientEmail.toLowerCase();
    console.log(
      `[Supabase] Recording transfer: ${senderEmail} -> ${recipientEmail} ($${params.amount})`,
    );

    const { data: users, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .or(`email.eq.${senderEmail},email.eq.${recipientEmail}`);

    if (fetchError) {
      console.error(
        "[Supabase] Failed to fetch users for recording:",
        fetchError,
      );
      return;
    }

    const sender = users?.find((u) => u.email.toLowerCase() === senderEmail);
    const recipient = users?.find(
      (u) => u.email.toLowerCase() === recipientEmail,
    );

    if (!sender) {
      console.warn(`[Supabase] Sender ${redactEmail(senderEmail)} not found. Skipping.`);
      return;
    }

    const baseRow = {
      sender_id: sender.id,
      sender_email: senderEmail,
      recipient_id: recipient?.id || null,
      recipient_email: recipientEmail,
      amount: params.amount,
      status: params.status,
      note: params.note || null,
      tx_hash: params.txHash || null,
      asset: "USDC" as const,
    };

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("transfers")
      .insert(
        params.chain ? { ...baseRow, source_chain: params.chain } : baseRow,
      )
      .select("id")
      .single();

    let transferId = inserted?.id || "";

    if (insertError && params.chain) {
      // `source_chain` may not exist yet (migration 024 not applied) — retry without it
      // so the ledger record still succeeds.
      const { data: retryInserted, error: retryError } = await supabaseAdmin
        .from("transfers")
        .insert(baseRow)
        .select("id")
        .single();
      if (retryError) {
        console.error("[Supabase] Failed to record transfer:", retryError);
      } else {
        transferId = retryInserted?.id || "";
      }
    } else if (insertError) {
      console.error("[Supabase] Failed to record transfer:", insertError);
    }

    if (!insertError) {
      console.log("[Supabase] Transfer recorded successfully");

      // 1. Send transaction receipt email to sender
      try {
        const { sendTransferSentEmail } = await import("@/lib/email/sendEmail");
        await sendTransferSentEmail(
          params.senderEmail,
          params.amount.toString(),
          params.recipientEmail,
          transferId,
          params.note,
          params.txHash,
          params.chain,
        );
      } catch (emailErr) {
        console.error(
          "[Supabase] Failed to send sender transfer receipt email:",
          emailErr,
        );
      }

      // 2. Send in-app notification to recipient
      if (recipient) {
        try {
          const { createNotification } = await import("./notifications");
          await createNotification(
            params.recipientEmail,
            "USDC Received",
            `You received ${params.amount} USDC from ${params.senderEmail}!`,
            "transfer",
            {
              url: `/dashboard/activity/${transferId}`,
              transactionId: transferId,
              amount: params.amount,
              sender: params.senderEmail,
            },
          );
        } catch (notifErr) {
          console.error(
            "[Supabase] Failed to send transfer notification:",
            notifErr,
          );
        }
      }
    }
  } catch (err) {
    console.error("[Supabase] Critical failure in recordTransfer:", err);
  }
}

// --- DEPOSITS ---

export async function recordDeposit(params: {
  userEmail: string;
  amountFiat: number;
  currencyFiat: string;
  amountUsdc: number;
  status: "pending" | "confirmed";
  paycrestTxId?: string;
  /** Chain the purchased USDC landed on (the user's home chain). Optional. */
  network?: string;
  /** Ramp provider that created the order ('bitnob' | 'paycrest'). Optional. */
  provider?: string;
}): Promise<void> {
  try {
    const normalizedEmail = params.userEmail.toLowerCase();
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (userError || !user) {
      console.error(
        `[Supabase] recordDeposit: User not found for ${normalizedEmail}`,
        userError,
      );
      return;
    }

    const baseRow = {
      user_id: user.id,
      amount_fiat: params.amountFiat,
      currency_fiat: params.currencyFiat,
      amount_usdc: params.amountUsdc,
      status: params.status,
      paycrest_tx_id: params.paycrestTxId || null,
    };

    const extra: Record<string, unknown> = {};
    if (params.network) extra.network = params.network;
    if (params.provider) extra.provider = params.provider;
    if (params.paycrestTxId) extra.provider_order_id = params.paycrestTxId;
    if (params.network) extra.provider_metadata = { network: params.network };
    const hasExtra = Object.keys(extra).length > 0;

    const { error: insertError } = await supabaseAdmin
      .from("deposits")
      .insert(hasExtra ? { ...baseRow, ...extra } : baseRow);

    if (insertError && hasExtra) {
      // `network`/`provider` may not exist yet (migration 025 not applied) — retry without.
      const { error: retryError } = await supabaseAdmin
        .from("deposits")
        .insert(baseRow);
      if (retryError) {
        console.error("[Supabase] recordDeposit INSERT ERROR:", retryError);
        return;
      }
    } else if (insertError) {
      console.error("[Supabase] recordDeposit INSERT ERROR:", insertError);
      return;
    }
    console.log(`[Supabase] recordDeposit SUCCESS for ${params.paycrestTxId}`);
  } catch (err) {
    console.error("[Supabase] Critical failure in recordDeposit:", err);
  }
}

export async function updateDepositStatus(
  paycrestTxId: string,
  status: "confirmed" | "failed" | "reversed",
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("deposits")
      .update({ status })
      .eq("provider_order_id", paycrestTxId);

    if (error) throw error;

    if (status === "confirmed") {
      interface DepositWithUser {
        id: string;
        amount_usdc: number;
        tx_hash?: string | null;
        network?: string | null;
        users: { email: string } | null;
      }

      const { data: depData } = (await supabaseAdmin
        .from("deposits")
        .select("id, amount_usdc, tx_hash, network, users (email)")
        .eq("provider_order_id", paycrestTxId)
        .maybeSingle()) as unknown as { data: DepositWithUser | null };

      if (depData && depData.users?.email) {
        const email = depData.users.email;
        const amount = depData.amount_usdc;
        const referenceId = depData.id;
        // Keep the on-chain hash distinct from the provider order ID — only the former
        // can be linked to an explorer.
        const txHash = depData.tx_hash || undefined;
        const depositChain = depData.network || undefined;

        const { createNotification } = await import("./notifications");
        await createNotification(
          email,
          "Deposit Confirmed",
          `Your deposit of ${amount} USDC has been successfully credited.`,
          "deposit",
          {
            url: `/dashboard/activity/${referenceId}`,
            transactionId: referenceId,
            amount,
          },
        );
        try {
          const { sendDepositEmail } = await import("@/lib/email/sendEmail");
          await sendDepositEmail(
            email,
            (amount || 0).toString(),
            referenceId,
            txHash,
            depositChain,
          );
        } catch (emailErr) {
          console.error(
            "[Supabase] Failed to send deposit email notification:",
            emailErr,
          );
        }
      }
    }
  } catch (err) {
    console.error("[Supabase] Failed to update deposit status:", err);
  }
}

// --- WITHDRAWALS ---

export async function recordWithdrawal(params: {
  userEmail: string;
  amountUsdc: number;
  fiatCurrency: string;
  fiatAmount?: number;
  exchangeRate?: number;
  bankAccountMasked: string;
  institutionCode: string;
  status: "processing" | "completed";
  paycrestOrderId?: string;
  /** Paycrest-supported chain the off-ramp settled from (base/polygon/ethereum). Optional. */
  sourceChain?: string;
  /** True when funds were spread across networks and auto-bridged onto sourceChain first. */
  consolidated?: boolean;
  /** Ramp provider that created the order ('bitnob' | 'paycrest'). Optional. */
  provider?: string;
  /** Bitnob quote id — used to finalize the payout after the USDC deposit lands. */
  bitnobQuoteId?: string;
  /** Bitnob deposit address — matches the `deposit.success` webhook to this withdrawal. */
  bitnobDepositAddress?: string;
  /** Platform fee taken on this withdrawal, in USDC (for reporting). */
  feeUsdc?: number;
  /** Platform fee percentage applied (for reporting). */
  feePercent?: number;
  /** Optional payment reference / memo (e.g. required for M-PESA / Kenya). */
  memo?: string;
  /**
   * Sealed beneficiary for a payout whose `initialize` is deferred, so the reconcile cron can
   * finish it if the user's browser drops after depositing. Scrubbed once initialized.
   */
  pendingBeneficiary?: string | null;
}): Promise<void> {
  try {
    const normalizedEmail = params.userEmail.toLowerCase();
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (!user) throw new Error(`User not found: ${normalizedEmail}`);

    const baseRow = {
      user_id: user.id,
      amount_usdc: params.amountUsdc,
      fiat_currency: params.fiatCurrency,
      fiat_amount: params.fiatAmount ?? null,
      exchange_rate: params.exchangeRate ?? null,
      bank_account_masked: params.bankAccountMasked,
      institution_code: params.institutionCode,
      status: params.status,
      paycrest_order_id: params.paycrestOrderId || null,
      verification_status: "verified" as const,
      memo: params.memo ?? null,
    };

    const extra: Record<string, unknown> = {};
    if (params.sourceChain || params.consolidated) {
      extra.source_chain = params.sourceChain ?? null;
      extra.consolidated = params.consolidated ?? false;
    }
    if (params.provider) extra.provider = params.provider;
    if (params.pendingBeneficiary) extra.pending_beneficiary = params.pendingBeneficiary;
    // Provider-agnostic: everything provider-specific lives in provider_metadata (JSONB).
    // paycrest_order_id is still dual-written (baseRow) ONLY for prod rollback safety and is
    // dropped in the final post-rollout migration.
    if (params.paycrestOrderId)
      extra.provider_order_id = params.paycrestOrderId;
    const metadata: Record<string, unknown> = {};
    if (params.bitnobQuoteId) metadata.quote_id = params.bitnobQuoteId;
    if (params.bitnobDepositAddress)
      metadata.deposit_address = params.bitnobDepositAddress;
    if (params.sourceChain) metadata.network = params.sourceChain;
    if (params.feeUsdc != null) metadata.fee_usdc = params.feeUsdc;
    if (params.feePercent != null) metadata.fee_percent = params.feePercent;
    if (Object.keys(metadata).length > 0) extra.provider_metadata = metadata;

    const chainRow =
      Object.keys(extra).length > 0 ? { ...baseRow, ...extra } : baseRow;

    const { error: insertError } = await supabaseAdmin
      .from("withdrawals")
      .insert(chainRow);

    if (insertError && chainRow !== baseRow) {
      // extra columns may not exist yet (migration not applied) — retry without.
      const { error: retryError } = await supabaseAdmin
        .from("withdrawals")
        .insert(baseRow);
      if (retryError) {
        console.error(
          "[Supabase] Failed to record withdrawal:",
          retryError.message,
        );
        return;
      }
    } else if (insertError) {
      console.error(
        "[Supabase] Failed to record withdrawal:",
        insertError.message,
      );
      return;
    }
    console.log(`[Supabase] Withdrawal recorded: ${params.paycrestOrderId}`);
  } catch (err) {
    console.error("[Supabase] Critical failure in recordWithdrawal:", err);
  }
}

export async function triggerWithdrawalNotifications(
  paycrestOrderId: string,
  status: "completed" | "failed" | "reversed",
): Promise<void> {
  try {
    // Everything the receipt renders. The email used to select six columns and print six rows,
    // which is why it arrived thinner than the receipt in the app — the hash, memo, chain and
    // bank were never fetched, let alone shown.
    interface WithdrawalNotificationData {
      id: string;
      amount_usdc: number;
      fiat_amount?: number | null;
      fiat_currency?: string | null;
      exchange_rate?: number | null;
      bank_account_masked?: string | null;
      institution_code?: string | null;
      provider?: string | null;
      provider_order_id?: string | null;
      tx_hash?: string | null;
      source_chain?: string | null;
      memo?: string | null;
      created_at?: string | null;
      users?: { email: string } | null;
    }

    const { data: wData } = (await supabaseAdmin
      .from("withdrawals")
      .select(
        "id, amount_usdc, fiat_amount, fiat_currency, exchange_rate, bank_account_masked, " +
          "institution_code, provider, provider_order_id, tx_hash, source_chain, memo, " +
          "created_at, users (email)",
      )
      .eq("provider_order_id", paycrestOrderId)
      .maybeSingle()) as unknown as { data: WithdrawalNotificationData | null };

    if (!wData || !wData.users?.email) {
      console.warn(
        `[Supabase] No withdrawal data found for order ${paycrestOrderId} to trigger notifications`,
      );
      return;
    }

    const email = wData.users.email;
    const amount = wData.amount_usdc;
    const fiatAmount = wData.fiat_amount || amount;
    const fiatCurrency = wData.fiat_currency || "USD";
    const bankMasked = wData.bank_account_masked || "••••";
    const referenceId = wData.id;
    const orderId = wData.provider_order_id || paycrestOrderId;

    // ── Notify once, however many things notice the withdrawal finished ──────
    //
    // Completion is detected from several independent places: the provider webhook, the
    // browser's status polling, and the reconcile cron. Each guards on the row still being
    // `processing`, but that is a read followed by a write — two of them can pass the check
    // before either finalizes, and the user gets the same news twice.
    //
    // The in-app notification is the record of having told them, so it is also the lock. No new
    // table or column: if a notification for this withdrawal and outcome already exists, the
    // work was already done.
    const notifTitle =
      status === "completed" ? "Withdrawal Completed" : "Withdrawal Failed";

    const { data: alreadyNotified } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("type", "withdrawal")
      .eq("title", notifTitle)
      .eq("data->>transactionId", referenceId)
      .limit(1);

    if (alreadyNotified && alreadyNotified.length > 0) {
      console.log(
        `[Supabase] Withdrawal ${orderId} already notified as ${status} — skipping duplicate ` +
          `notification and email.`,
      );
      return;
    }

    const { createNotification } = await import("./notifications");

    if (status === "completed") {
      // Awaited BEFORE the email rather than raced alongside it: this row is what the guard
      // above reads, so writing it first is what actually closes the window on a second caller
      // arriving mid-send. The email is the slow half — starting it first would leave that
      // window open for as long as the mail provider takes.
      await createNotification(
        email,
        notifTitle,
        `Your withdrawal of ${amount} USDC has been successfully processed to your bank account.`,
        "withdrawal",
        {
          url: `/dashboard/activity/${referenceId}`,
          transactionId: referenceId,
          amount,
          fiatAmount,
          fiatCurrency,
        },
      ).catch((err) => {
        console.error("[Supabase] Failed to create in-app notification:", err);
      });

      const emailPromise = (async () => {
        try {
          // The code is what the payout was addressed with; the NAME is what belongs on a
          // receipt. Derived rather than stored, so there is nothing to migrate or keep in sync.
          // Resolved inside the success path so a failed withdrawal does not pay for the lookup.
          //
          // Two sources, cheapest and most reliable first:
          //   1. the user's own saved bank contacts — a plain DB read, and the name THEY know
          //      the bank by;
          //   2. the provider's institution list, which is an outbound API call and therefore
          //      the thing that fails first — an unwhitelisted IP or a provider blip returns
          //      nothing and the receipt silently fell back to printing "000013".
          // The code remains the last resort, since a code beats an empty row.
          const institutionCode = wData.institution_code ?? undefined;

          let bankLabel: string | undefined = institutionCode;
          if (institutionCode) {
            const { data: contact } = await supabaseAdmin
              .from("bank_contacts")
              .select("bank_name")
              .eq("bank_code", institutionCode)
              .limit(1)
              .maybeSingle();

            if (contact?.bank_name) {
              bankLabel = contact.bank_name;
            } else {
              const { Ramp } = await import("@/lib/ramp");
              const resolved = await Ramp.resolveBankName(
                (wData.provider as "bitnob" | "paycrest") || "bitnob",
                institutionCode,
                fiatCurrency,
              ).catch(() => null);
              if (resolved) bankLabel = resolved;
            }
          }

          // The receipt template omits any row it has no value for, so a thin email is always a
          // sparse ROW, never a template problem. Log which fields were missing so that is
          // answerable from the logs instead of by inspecting an inbox.
          const missing = (
            [
              ["fiat_amount", wData.fiat_amount],
              ["exchange_rate", wData.exchange_rate],
              ["institution_code", wData.institution_code],
              ["source_chain", wData.source_chain],
              ["tx_hash", wData.tx_hash],
              ["memo", wData.memo],
            ] as const
          )
            .filter(([, v]) => v == null || v === "")
            .map(([k]) => k);
          console.log(
            `[Supabase] Withdrawal receipt email for ${orderId}: bank=${bankLabel ?? "unresolved"}` +
              (missing.length ? `, missing ${missing.join(", ")}` : ", all fields present"),
          );

          const { sendWithdrawalEmail } = await import("@/lib/email/sendEmail");
          await sendWithdrawalEmail(email, {
            id: referenceId,
            type: "withdrawal",
            status: "completed",
            timestamp: wData.created_at ?? new Date().toISOString(),
            amountUsdc: amount,
            fiatCurrency,
            // The payout, not the USDC — `fiatPayoutAmount` is the row the template labels
            // "Payout Amount", which is what the recipient's bank actually received.
            fiatPayoutAmount: wData.fiat_amount ?? undefined,
            exchangeRate: wData.exchange_rate ?? undefined,
            bankAccount: bankMasked,
            bankName: bankLabel,
            sourceChain: wData.source_chain ?? undefined,
            txHash: wData.tx_hash ?? undefined,
            note: wData.memo ?? undefined,
            orderId,
          });
        } catch (emailErr) {
          console.error(
            "[Supabase] Failed to send withdrawal email notification:",
            emailErr,
          );
        }
      })();

      await emailPromise;
    } else {
      // Does this failure owe the user money? Only if their deposit actually landed — the RPC
      // records that as `refund_owed_usdc` when it fails a withdrawal that already has a
      // tx_hash. A failure before the deposit owes nothing: the user still holds their USDC.
      const { data: refundRow } = await supabaseAdmin
        .from("withdrawals")
        .select("refund_owed_usdc, refund_tx_hash, source_chain, user_id")
        .eq("id", referenceId)
        .maybeSingle();

      const owed = Number(refundRow?.refund_owed_usdc ?? 0);
      const refundOwed = owed > 0 && !refundRow?.refund_tx_hash;

      await createNotification(
        email,
        notifTitle,
        refundOwed
          ? `Your withdrawal of ${amount} USDC could not be completed. We are returning your ` +
            `funds — you will receive ${owed} USDC back shortly.`
          : `Your withdrawal of ${amount} USDC has failed. Your funds remain in your wallet.`,
        "withdrawal",
        {
          url: `/dashboard/activity/${referenceId}`,
          transactionId: referenceId,
          amount,
          fiatAmount,
          fiatCurrency,
        },
      ).catch((err) => {
        console.error("[Supabase] Failed to create failed in-app notification:", err);
      });

      // ── Tell the people who can fix it ────────────────────────────────────
      //
      // This is the alert that was missing. A refund-owed failure looks exactly like an
      // ordinary one from the outside, so the first one was found only when the user complained
      // — by which time their money had been gone for hours.
      //
      // Inside the notification guard above, so the webhook, the browser and the cron all
      // noticing the same failure send one alert between them, not three.
      if (refundOwed) {
        const chain = refundRow?.source_chain ?? null;
        const { data: u } = await supabaseAdmin
          .from("users")
          .select("smart_account_address, solana_address, stellar_address")
          .eq("id", refundRow!.user_id)
          .maybeSingle();

        const { refundDestination } = await import("@/lib/ramp/refund");
        const refundAddress = refundDestination(chain, u);

        const { sendRefundOwedAlert } = await import("@/lib/email/admin-alerts");
        await sendRefundOwedAlert({
          withdrawalId: referenceId,
          orderId,
          userEmail: email,
          owedUsdc: owed,
          amountUsdc: amount,
          feeUsdc: Math.max(0, owed - amount),
          fiatAmount: wData.fiat_amount ?? null,
          fiatCurrency,
          chain,
          txHash: wData.tx_hash ?? null,
          refundAddress,
          provider: wData.provider ?? null,
        });
      }
    }
  } catch (err) {
    console.error(
      "[Supabase] Failed to trigger withdrawal notifications:",
      err,
    );
  }
}

export async function updateWithdrawalStatus(
  paycrestOrderId: string,
  status: "completed" | "failed" | "reversed",
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("withdrawals")
      .update({ status })
      .eq("provider_order_id", paycrestOrderId);

    if (error) throw error;

    if (status === "completed") {
      await triggerWithdrawalNotifications(paycrestOrderId, "completed");
    } else {
      await triggerWithdrawalNotifications(paycrestOrderId, "failed");
    }
  } catch (err) {
    console.error("[Supabase] Failed to update withdrawal status:", err);
  }
}

export async function saveWithdrawalTxHash(
  paycrestOrderId: string,
  txHash: string,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("withdrawals")
      .update({ tx_hash: txHash })
      .eq("provider_order_id", paycrestOrderId);

    if (error) throw error;
  } catch (err) {
    console.error("[Supabase] Failed to save withdrawal tx hash:", err);
  }
}

/**
 * Drop the deposit-scanner's shadow of a fiat-ramp delivery, so the provider row can take
 * the hash. Call this immediately before writing `tx_hash` onto a provider deposit.
 *
 * A ramp row is created before its hash is known, and `knownHashes` in the deposit scanner
 * only collects non-null hashes — so between the provider's on-chain send and its webhook,
 * the scanner sees an unattributed arrival and records it as `provider: 'onchain'`. Once the
 * webhook names the hash, the two rows are the same money, and the provider row is the one to
 * keep: it alone carries the fiat side (amount, currency, order id).
 *
 * Since `deposits_user_tx_hash_uniq` (migration 035) forbids the pair, clearing the shadow
 * isn't just tidiness — without it the provider's own update would hit a unique violation.
 */
export async function clearOnchainDepositShadow(
  providerOrderId: string,
  txHash: string,
): Promise<void> {
  try {
    const { data: row } = await supabaseAdmin
      .from("deposits")
      .select("id, user_id")
      .eq("provider_order_id", providerOrderId)
      .maybeSingle();
    if (!row?.user_id) return;

    const { data: removed, error } = await supabaseAdmin
      .from("deposits")
      .delete()
      .eq("user_id", row.user_id)
      .eq("tx_hash", txHash)
      .eq("provider", "onchain")
      .neq("id", row.id)
      .select("id");

    if (error) throw error;
    if (removed?.length) {
      console.log(
        `[Supabase] Replaced ${removed.length} scanned deposit(s) with ramp order ${providerOrderId}`,
      );
    }
  } catch (err) {
    // Non-fatal: the caller's update is the important half. Worst case the duplicate
    // survives and the update is rejected by the unique index, which the caller logs.
    console.error("[Supabase] Failed to clear on-chain deposit shadow:", err);
  }
}

export async function saveDepositTxHash(
  paycrestTxId: string,
  txHash: string,
): Promise<void> {
  try {
    await clearOnchainDepositShadow(paycrestTxId, txHash);

    const { error } = await supabaseAdmin
      .from("deposits")
      .update({ tx_hash: txHash })
      .eq("provider_order_id", paycrestTxId);

    if (error) throw error;
  } catch (err) {
    console.error("[Supabase] Failed to save deposit tx hash:", err);
  }
}

// --- BRIDGE TRANSACTIONS ---

export async function recordBridgeTransaction(params: {
  userEmail: string;
  sourceChain: string;
  destChain: string;
  amountUsdc: number;
  burnTxHash: string;
}): Promise<void> {
  try {
    const normalizedEmail = params.userEmail.toLowerCase();
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (userError || !user) {
      console.error(`[Supabase] User not found for bridge: ${redactEmail(normalizedEmail)}`);
      return;
    }

    const { error } = await supabaseAdmin.from("bridge_transactions").insert({
      user_id: user.id,
      source_chain: params.sourceChain,
      dest_chain: params.destChain,
      amount: params.amountUsdc,
      burn_tx_hash: params.burnTxHash,
      attestation_status: "pending",
    });

    if (error) throw error;
  } catch (err) {
    console.error("[Supabase] Failed to record bridge tx:", err);
  }
}

export async function updateBridgeStatus(
  burnTxHash: string,
  status: "complete" | "failed",
  mintTxHash?: string,
): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("bridge_transactions")
      .select("attestation_status, mint_tx_hash")
      .eq("burn_tx_hash", burnTxHash)
      .maybeSingle();

    console.log(
      `[updateBridgeStatus] burn=${burnTxHash.slice(0, 10)} existing=${JSON.stringify(existing)} mintTxHash=${mintTxHash?.slice(0, 10)}`,
    );

    // A delivered burn no longer needs its scratch row, whether it came from the user's own
    // bridge history or from a withdrawal consolidation. Cleared here rather than at each call
    // site so no claim path can forget it and leave a card the user cannot dismiss.
    if (status === "complete") {
      await supabaseAdmin
        .from("consolidation_claims")
        .delete()
        .eq("burn_tx_hash", burnTxHash);
    }

    if (!existing) {
      // Expected for a consolidation: those never get a `bridge_transactions` row, by design.
      // The scratch row above is the whole record, and it has just been cleared.
      console.log(
        `[updateBridgeStatus] No bridge_transactions row for ${burnTxHash.slice(0, 10)} — ` +
          `treating as a consolidation claim.`,
      );
      return;
    }

    // 'CONFIRMED_ON_CHAIN' is a sentinel some older rows still carry. Counting it as a
    // real hash would make this refuse to overwrite it once the true one is recovered.
    const isPlaceholder = (h: string | null | undefined) =>
      !h ||
      h.toLowerCase() === 'n/a' ||
      h.toUpperCase() === 'CONFIRMED_ON_CHAIN' ||
      h === '0x0000000000000000000000000000000000000000000000000000000000000000';

    const existingIsReal = existing.mint_tx_hash && !isPlaceholder(existing.mint_tx_hash);
    const newIsReal = mintTxHash && !isPlaceholder(mintTxHash);

    if (existingIsReal && !newIsReal) {
      console.log(
        `[updateBridgeStatus] Existing hash is real, but new hash is placeholder/empty — skipping update.`
      );
      return;
    }
    if (existingIsReal && newIsReal && existing.mint_tx_hash === mintTxHash) {
      console.log(
        `[updateBridgeStatus] Already complete with same real mint hash — skipping update.`
      );
      return;
    }

    const wasAlreadyComplete = existing.attestation_status === "complete";

    const { error } = await supabaseAdmin
      .from("bridge_transactions")
      .update({
        attestation_status: status as "complete" | "failed" | "pending",
        mint_tx_hash: mintTxHash || null,
        updated_at: new Date().toISOString(),
      })
      .eq("burn_tx_hash", burnTxHash)
      .select("id");

    if (error) {
      console.error(`[updateBridgeStatus] Update failed:`, error);
      throw error;
    }
    console.log(
      `[updateBridgeStatus] Updated — mintTxHash saved: ${mintTxHash ?? "null"}`,
    );

    if (status === "complete" && !wasAlreadyComplete) {
      interface BridgeTxWithUser {
        id: string;
        amount: number;
        source_chain: string;
        dest_chain: string;
        burn_tx_hash: string;
        users: { email: string } | null;
      }

      const { data: txData } = (await supabaseAdmin
        .from("bridge_transactions")
        .select(
          "id, amount, source_chain, dest_chain, burn_tx_hash, users (email)",
        )
        .eq("burn_tx_hash", burnTxHash)
        .maybeSingle()) as unknown as { data: BridgeTxWithUser | null };

      if (txData && txData.users?.email) {
        const email = txData.users.email;
        const amount = txData.amount;
        const src = txData.source_chain;
        const dest = txData.dest_chain;
        const referenceId = txData.id;
        const sourceHash = txData.burn_tx_hash || burnTxHash;

        // A receipt is the one place the mint hash really matters, so make a final
        // attempt to recover it before falling back to the placeholder — and persist
        // whatever we find so the activity page links it too.
        let destinationHash = mintTxHash || undefined;
        if (isPlaceholderHash(destinationHash)) {
          const recovered = await recoverMintTxHash(src, dest, sourceHash);
          if (recovered) {
            destinationHash = recovered;
            await supabaseAdmin
              .from("bridge_transactions")
              .update({ mint_tx_hash: recovered })
              .eq("burn_tx_hash", burnTxHash);
          }
        }

        const { createNotification } = await import("./notifications");
        await createNotification(
          email,
          "USDC Bridge Completed",
          `Successfully bridged ${amount} USDC from ${src.toUpperCase()} to ${dest.toUpperCase()}!`,
          "bridge",
          {
            url: `/dashboard/activity/${referenceId}`,
            transactionId: referenceId,
            amount,
            src,
            dest,
          },
        );

        try {
          const { sendBridgeEmail } = await import("@/lib/email/sendEmail");
          await sendBridgeEmail(
            email,
            amount.toString(),
            src,
            dest,
            referenceId,
            destinationHash,
            sourceHash,
          );
        } catch (emailErr) {
          console.error(
            "[Supabase] Failed to send bridge email notification:",
            emailErr,
          );
        }
      }
    }
  } catch (err) {
    console.error("[Supabase] Failed to update bridge status:", err);
  }
}

/**
 * Burns that were never minted on their destination chain.
 *
 * `getUserActivities` also refreshes bridge state, but it scans deposits and pulls
 * five tables — far too heavy to poll. This is the narrow read the Pending Claims
 * panel polls: unminted burns plus the attestation each one needs to be claimed.
 *
 * A row is only surfaced once Circle has attested the burn, the mint is still missing,
 * and the live bridge flow has had its chance — otherwise every normal bridge would
 * flash an "unclaimed" banner during the gap between attestation and mint.
 */



/**
 * A viem client for an EVM chain.
 *
 * viem and the RPC config are imported lazily on purpose: this module is pulled into client
 * components for its server actions, and a static import would drag the whole chain stack into
 * the browser bundle.
 */
async function evmClient(chain: string) {
  const { createPublicClient } = await import("viem");
  const { rpcTransport } = await import("@/lib/web3/rpc");
  return createPublicClient({ transport: rpcTransport(chain) });
}

/**
 * The transaction that minted a CCTP message on an EVM destination, if it can be found.
 *
 * Best effort everywhere it is used: a missing hash costs a link, never a reconciliation.
 */
async function findEvmMintTxHash(
  destChain: string,
  messageBytes: string,
): Promise<string | undefined> {
  const dest = destChain.toLowerCase();
  if (!EVM_CHAINS.includes(dest)) return undefined;

  try {
    const { findMintTxHash } = await import("@/lib/web3/cctp-delivery");
    return await findMintTxHash(await evmClient(dest), messageBytes);
  } catch (err) {
    console.error("[findEvmMintTxHash] Lookup failed:", (err as Error).message);
    return undefined;
  }
}

const EVM_CHAINS = [
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "avalanche",
  "ethereum",
];

/**
 * Has the destination chain already consumed this message's nonce?
 *
 * EVM reads the MessageTransmitter's used-nonce map directly. Stellar has no such read, so it
 * simulates the claim and treats an already-received rejection as proof (see lib/stellar/
 * delivery). Solana still has no check — its burns fall back to the record written when the
 * claim succeeded.
 *
 * Returns false whenever the answer is unknown, so an unreachable RPC or an unrecognised error
 * never hides a transfer the user still needs to claim.
 */
async function isBurnDelivered(
  destChain: string,
  messageBytes: string,
  attestation?: string,
): Promise<boolean> {
  const dest = destChain.toLowerCase();

  if (dest === "stellar") {
    if (!attestation) return false;
    const { isStellarBurnDelivered } = await import("@/lib/stellar/delivery");
    return isStellarBurnDelivered(messageBytes, attestation);
  }

  if (!EVM_CHAINS.includes(dest)) return false;

  try {
    const { isMessageDelivered } = await import("@/lib/web3/cctp-delivery");
    return await isMessageDelivered(await evmClient(dest), messageBytes);
  } catch (err) {
    console.error(
      `[getPendingBridgeClaims] Delivery check failed on ${dest}:`,
      (err as Error).message,
    );
    return false;
  }
}

type AttestationResult = Awaited<ReturnType<typeof getAttestation>>;

/**
 * How long a burn may go unattested before we stop assuming Circle is just slow.
 *
 * Attestation normally takes a minute or two. An hour is far past that, and comfortably past
 * any chain reorg, so beyond it "Circle has never heard of this" is worth investigating rather
 * than waiting on.
 */
const UNATTESTED_GRACE_MS = 60 * 60 * 1000;

/**
 * Does this burn transaction actually exist on its source chain?
 *
 * Returns null when we cannot tell — an unreadable chain, an RPC that is down. Only a definite
 * "no receipt" answers false, because this decides whether a row is written off.
 */
async function burnExistsOnChain(
  sourceChain: string,
  txHash: string,
): Promise<boolean | null> {
  const chain = sourceChain.toLowerCase();
  if (!EVM_CHAINS.includes(chain) || !txHash.startsWith("0x")) return null;

  try {
    const client = await evmClient(chain);
    await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
    return true;
  } catch (err) {
    // viem raises the same error type for "mined but not found" and "no such transaction",
    // and only the message distinguishes them. Anything else is an unknown, not an absence.
    const message = (err as Error)?.message ?? "";
    return message.includes("could not be found") ? false : null;
  }
}

/**
 * A burn that was recorded but never made it on-chain.
 *
 * The row is written when the transaction is submitted, not when it confirms, so a submission
 * that is dropped or replaced leaves a row describing a burn that never happened. Circle has no
 * message for it and never will, which used to mean a card sitting on "Verifying" forever with
 * no way for the user to dismiss it. Nothing was burned, so nothing is owed: mark it and let it
 * go. The row stays for the record rather than being deleted.
 */
async function markBridgeUnclaimable(burnTxHash: string): Promise<void> {
  console.warn(
    `[getPendingBridgeClaims] ${burnTxHash.slice(0, 12)} has no attestation and no receipt on ` +
      `its source chain — the burn never landed. Marking it unclaimable.`,
  );
  await supabaseAdmin
    .from("bridge_transactions")
    .update({ attestation_status: "failed", updated_at: new Date().toISOString() })
    .eq("burn_tx_hash", burnTxHash);
}

/**
 * Has this burn already landed on its destination chain, and if so, record that it did.
 *
 * Circle only reports a mint hash for transfers its own relayer delivered, so a claim the user
 * made themselves leaves Iris looking identical to one that never happened. The destination
 * chain is the only authority on whether the money arrived, so ask it directly before insisting
 * the funds are still owed.
 *
 * Returns the mint hash it settled on, or null when the burn genuinely has not been delivered.
 * The hash is PLACEHOLDER_TX_HASH when the chain confirms delivery but the transaction itself
 * cannot be recovered — delivery is the fact that matters, and refusing to record it without a
 * hash is what used to leave a delivered transfer showing a Claim button that could only fail.
 */
async function settleIfDelivered(
  burnTxHash: string,
  destChain: string,
  attested: AttestationResult,
): Promise<string | null> {
  if (attested.status !== "complete") return null;

  // Circle's own relayer delivered it and told us exactly where.
  if (attested.mintTxHash) {
    await updateBridgeStatus(burnTxHash, "complete", attested.mintTxHash);
    return attested.mintTxHash;
  }

  if (!attested.messageBytes) return null;

  const delivered = await isBurnDelivered(
    destChain,
    attested.messageBytes,
    attested.attestation ?? undefined,
  );
  if (!delivered) return null;

  // Try for the real hash so history can link to an explorer, but do not require it.
  const resolved =
    (await findEvmMintTxHash(destChain, attested.messageBytes)) ?? PLACEHOLDER_TX_HASH;
  await updateBridgeStatus(burnTxHash, "complete", resolved);
  return resolved;
}

/**
 * Ask the destination chain whether one specific burn has already been claimed.
 *
 * The Pending Claims list runs the same check on every refresh, but a claim that fails mid
 * flight lands between two of those passes: the mint may already have gone through — a relayer
 * beat us to it, another tab finished first, the transaction confirmed after our poll gave up —
 * while the button reports a plain failure and the card stays put. Retrying then can only fail
 * again, because the nonce is spent.
 *
 * So the claim button calls this before it starts and again if it fails. When this says the
 * money arrived, the row is reconciled and cleared instead of a scary error being shown for
 * funds that are already home.
 *
 * Scoped to the caller's own rows: a burn hash is public, and letting anyone settle a stranger's
 * claim would hide money they are still owed.
 */
export async function verifyBridgeClaimSettled(
  burnTxHash: string,
  accessToken?: string,
): Promise<{ settled: boolean; mintTxHash: string | null }> {
  const unsettled = { settled: false, mintTxHash: null };
  try {
    const { email } = await requireUser(accessToken);
    const { data: userRecord } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();
    if (!userRecord?.id) return unsettled;

    const [{ data: bridge }, { data: scratch }] = await Promise.all([
      supabaseAdmin
        .from("bridge_transactions")
        .select("source_chain, dest_chain")
        .eq("burn_tx_hash", burnTxHash)
        .eq("user_id", userRecord.id)
        .maybeSingle(),
      supabaseAdmin
        .from("consolidation_claims")
        .select("source_chain, dest_chain")
        .eq("burn_tx_hash", burnTxHash)
        .eq("user_id", userRecord.id)
        .maybeSingle(),
    ]);

    const row = bridge ?? scratch;
    if (!row) return unsettled;

    const attested = await getAttestation(
      row.source_chain as ExtendedChain,
      burnTxHash,
    );
    const mintTxHash = await settleIfDelivered(burnTxHash, row.dest_chain, attested);

    return mintTxHash
      ? { settled: true, mintTxHash: isPlaceholderHash(mintTxHash) ? null : mintTxHash }
      : unsettled;
  } catch (err) {
    // Unknown is not settled. Reporting a claim as delivered because a lookup failed would
    // hide USDC the user still has to claim, which is the one outcome worth avoiding here.
    console.error(
      `[verifyBridgeClaimSettled] Could not verify ${burnTxHash.slice(0, 10)}:`,
      (err as Error).message,
    );
    return unsettled;
  }
}

export async function getPendingBridgeClaims(
  accessToken?: string,
): Promise<PendingBridgeClaim[]> {
  try {
    const { email: normalizedEmail } = await requireUser(accessToken);
    const { data: userRecord } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (!userRecord?.id) return [];

    // Bridges the user made themselves, from their history.
    const { data: userBridges } = await supabaseAdmin
      .from("bridge_transactions")
      .select("id, source_chain, dest_chain, amount, burn_tx_hash, mint_tx_hash, created_at")
      .eq("user_id", userRecord.id)
      // Unfinished means one thing: no mint hash. A delivered transfer always records one —
      // the real hash when we can recover it, PLACEHOLDER_TX_HASH when we can't — so a null
      // here means the claim leg genuinely never landed.
      //
      // This used to also require `attestation_status != complete`, a workaround from before
      // the placeholder existed, when a confirmed delivery wrote a null hash and the card
      // never went away. It excluded the exact rows that need claiming: `complete` is what
      // Circle reports once the ATTESTATION is ready, which is the moment a burn becomes
      // claimable. So every burn that was ready to claim and never claimed — a closed tab, a
      // refresh, a declined signature — was filtered out of the one screen built to recover it,
      // and the USDC stayed burned and invisible.
      //
      // Whether the money actually arrived is decided per row below, against Circle and the
      // destination chain, which is the only authority on it. A stored status is not.
      .is("mint_tx_hash", null)
      // Written off: the burn never reached the chain, so there is nothing to claim. Matched
      // with an explicit null check because `neq` alone drops rows whose status is null.
      .or("attestation_status.is.null,attestation_status.neq.failed")
      .order("created_at", { ascending: false })
      .limit(20);

    // Bridges that happened inside a withdrawal. These are NOT history — they live in a
    // scratch table that is cleared on delivery, so a row here means a burn is still
    // outstanding. Without them a consolidation that failed to deliver would be invisible
    // everywhere, which is how a real 10.71 USDC burn went missing.
    const { data: consolidations } = await supabaseAdmin
      .from("consolidation_claims")
      .select("id, source_chain, dest_chain, amount, burn_tx_hash, created_at")
      .eq("user_id", userRecord.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const rows = [
      ...(userBridges ?? []),
      ...(consolidations ?? []).map((c) => ({ ...c, mint_tx_hash: null })),
    ];

    if (rows.length === 0) return [];

    const claims = await Promise.all(
      rows.map(async (row): Promise<PendingBridgeClaim | null> => {
        try {
          const result = await getAttestation(
            row.source_chain as ExtendedChain,
            row.burn_tx_hash,
          );

          // Already landed? Then it is settled, recorded, and has no business on this list.
          if (await settleIfDelivered(row.burn_tx_hash, row.dest_chain, result)) {
            return null;
          }

          // Still unattested long after it should be. Either Circle is behind, or the burn
          // never actually happened — and only the source chain can tell us which.
          const ageMs = Date.now() - new Date(row.created_at).getTime();
          if (result.status !== "complete" && ageMs > UNATTESTED_GRACE_MS) {
            if ((await burnExistsOnChain(row.source_chain, row.burn_tx_hash)) === false) {
              await markBridgeUnclaimable(row.burn_tx_hash);
              return null;
            }
          }

          return {
            id: row.id,
            burnTxHash: row.burn_tx_hash,
            sourceChain: row.source_chain,
            destChain: row.dest_chain,
            amount: row.amount,
            createdAt: row.created_at,
            ready: result.status === "complete",
            messageBytes: result.messageBytes ?? undefined,
            attestation: result.attestation ?? undefined,
          };
        } catch (err) {
          console.error(
            `[getPendingBridgeClaims] Attestation lookup failed for ${row.burn_tx_hash}:`,
            err,
          );
          // Still show it — the user can retry; the claim itself re-fetches.
          return {
            id: row.id,
            burnTxHash: row.burn_tx_hash,
            sourceChain: row.source_chain,
            destChain: row.dest_chain,
            amount: row.amount,
            createdAt: row.created_at,
            ready: false,
          };
        }
      }),
    );

    return claims.filter((c): c is PendingBridgeClaim => c !== null);
  } catch (err) {
    console.error("[Supabase] Failed to load pending bridge claims:", err);
    return [];
  }
}

// --- ACTIVITY HISTORY ---

/**
 * A user's own activity history.
 *
 * Takes no email: it used to, which made it an open endpoint for reading anyone's entire
 * financial history by typing their address. The account read is now whichever account the
 * session belongs to, so there is no "other user" to ask for.
 */
export async function getUserActivities(accessToken?: string) {
  try {
    const session = await requireUser(accessToken);
    const normalizedEmail = session.email;
    const { data: userRecord } = await supabaseAdmin
      .from("users")
      .select("id, smart_account_address, solana_address, stellar_address")
      .eq("email", normalizedEmail)
      .single();

    const internalId = userRecord?.id;
    if (!internalId)
      return {
        sent: [],
        received: [],
        deposits: [],
        withdrawals: [],
        bridges: [],
      };

    // Record any new on-chain USDC deposits BEFORE reading the deposits table, so freshly
    // received crypto shows up in history. Best-effort + throttled — never blocks the load.
    if (
      userRecord?.smart_account_address ||
      userRecord?.solana_address ||
      userRecord?.stellar_address
    ) {
      try {
        const { scanUsdcDeposits } = await import("@/lib/web3/deposit-scanner");
        await scanUsdcDeposits({
          userId: internalId,
          address: userRecord.smart_account_address ?? "",
          solanaAddress: userRecord.solana_address ?? undefined,
          stellarAddress: userRecord.stellar_address ?? undefined,
        });
      } catch (e) {
        console.error("[Supabase] deposit scan failed (non-fatal):", e);
      }
    }

    const [
      { data: sent },
      { data: received },
      { data: deposits },
      { data: withdrawals },
      { data: bridges },
    ] = await Promise.all([
      supabaseAdmin
        .from("transfers")
        .select("*, sender:sender_id(email)")
        .eq("sender_id", internalId),
      supabaseAdmin
        .from("transfers")
        .select("*, sender:sender_id(email)")
        .or(
          `recipient_id.eq.${internalId},recipient_email.eq.${normalizedEmail}`,
        ),
      supabaseAdmin.from("deposits").select("*").eq("user_id", internalId),
      supabaseAdmin.from("withdrawals").select("*").eq("user_id", internalId),
      supabaseAdmin
        .from("bridge_transactions")
        .select("*")
        .eq("user_id", internalId),
    ]);

    // Check for any pending bridges and update them if they're actually complete.
    // IMPORTANT: Only call updateBridgeStatus (which fires notifications) when Circle's
    // relayer has already minted (mintTxHash present). For EVM→EVM bridges without
    // auto-relay, just update the DB status silently — the monitoring loop in the
    // frontend will call updateBridgeStatus with the real mintTxHash after the user
    // signs receiveMessage.
    const pendingBridges = (bridges || []).filter(
      (b) => !b.mint_tx_hash && b.attestation_status !== "complete",
    );
    if (pendingBridges.length > 0) {
      await Promise.all(
        pendingBridges.map(async (b) => {
          try {
            const result = await getAttestation(
              b.source_chain as ExtendedChain,
              b.burn_tx_hash,
            );
            if (result.status === "complete") {
              if (result.mintTxHash) {
                // Auto-relayed (Stellar→Base, Solana→Base) — safe to mark complete + notify
                await updateBridgeStatus(
                  b.burn_tx_hash,
                  "complete",
                  result.mintTxHash,
                );
                b.attestation_status = "complete";
                b.mint_tx_hash = result.mintTxHash;
              } else {
                // Attestation ready but user still needs to sign receiveMessage —
                // only update the DB status flag, do NOT fire notifications yet
                try {
                  await supabaseAdmin
                    .from("bridge_transactions")
                    .update({ attestation_status: "complete" })
                    .eq("burn_tx_hash", b.burn_tx_hash);
                } catch (dbErr) {
                  console.error("[getUserActivities] complete status update failed:", dbErr);
                }
                b.attestation_status = "complete";
              }
            } else if (
              result.status === "pending_confirmations" &&
              b.attestation_status === "pending"
            ) {
              try {
                await supabaseAdmin
                  .from("bridge_transactions")
                  .update({ attestation_status: "pending_confirmations" })
                  .eq("burn_tx_hash", b.burn_tx_hash);
              } catch (dbErr) {
                console.error("[getUserActivities] pending_confirmations status update failed:", dbErr);
              }
              b.attestation_status = "pending_confirmations";
            }
          } catch (e) {
            console.error("[Supabase] Failed to auto-update bridge status:", e);
          }
        }),
      );
    }

    // Check for pending deposits and update them
    const pendingDeposits = (deposits || []).filter(
      (d) => d.status === "pending" && d.provider_order_id,
    );
    if (pendingDeposits.length > 0) {
      await Promise.all(
        pendingDeposits.map(async (d) => {
          try {
            const { getOrderStatus } = await import("@/lib/actions/ramp");
            const result = await getOrderStatus(
              d.provider_order_id!,
              (d.provider as "bitnob" | "paycrest") || "paycrest",
            );
            const statusLower = result?.status?.toLowerCase();

            if (statusLower === "settled" || statusLower === "completed") {
              await updateDepositStatus(d.provider_order_id!, "confirmed");
              d.status = "confirmed";

              const settlementTxHash =
                result.txHash ||
                result.settlementTxHash ||
                result.transactionHash;
              if (settlementTxHash) {
                await saveDepositTxHash(d.provider_order_id!, settlementTxHash);
                d.tx_hash = settlementTxHash;
              }
            } else if (
              statusLower &&
              ["refunded", "refunding"].includes(statusLower)
            ) {
              await updateDepositStatus(d.provider_order_id!, "reversed");
              d.status = "reversed";
            } else if (
              statusLower &&
              ["expired", "failed"].includes(statusLower)
            ) {
              await updateDepositStatus(d.provider_order_id!, "failed");
              d.status = "failed";
            }
          } catch (e) {
            console.error(
              "[Supabase] Failed to auto-update deposit status:",
              e,
            );
          }
        }),
      );
    }

    // Check for pending withdrawals and update them via RPCs (same as webhook)
    // IMPORTANT: Must use finalize_withdrawal_success/failed RPCs — NOT updateWithdrawalStatus().
    // The RPCs atomically update balances + write audit logs. Direct status updates skip this.
    const pendingWithdrawals = (withdrawals || []).filter(
      (w) => w.status === "processing" && w.provider_order_id,
    );
    if (pendingWithdrawals.length > 0) {
      await Promise.all(
        pendingWithdrawals.map(async (w) => {
          try {
            // Route to the provider that created the order (tolerant of legacy rows). Provider
            // resolution lives in the ramp registry, so adding/removing a provider needs no change
            // here — see resolveLedgerProvider.
            const { resolveLedgerProvider } = await import("@/lib/ramp");
            const provider = resolveLedgerProvider(w);

            const { getOrderStatus } = await import("@/lib/actions/ramp");
            let result;
            try {
              result = await getOrderStatus(w.provider_order_id!, provider);
            } catch {
              // Order not found / not indexed at the provider yet (e.g. an old expired payout).
              // Leave it pending and let the webhook/cron reconcile — don't spam on every load.
              return;
            }
            const statusLower = result?.status?.toLowerCase();

            if (
              statusLower &&
              ["settled", "completed", "validated", "deposited"].includes(
                statusLower,
              )
            ) {
              const { error } = await supabaseAdmin.rpc(
                "finalize_withdrawal_success",
                {
                  p_paycrest_order_id: w.provider_order_id!,
                },
              );
              if (error) {
                console.error(
                  "[Supabase] finalize_withdrawal_success failed (polling):",
                  error.message,
                );
              } else {
                console.log(
                  `[Supabase] Polling: Withdrawal ${w.provider_order_id} finalized successfully`,
                );
                w.status = "completed";
                await triggerWithdrawalNotifications(
                  w.provider_order_id!,
                  "completed",
                );
              }
            } else if (
              statusLower &&
              ["refunded", "expired", "failed", "refunding"].includes(
                statusLower,
              )
            ) {
              const { error } = await supabaseAdmin.rpc(
                "finalize_withdrawal_failed",
                {
                  p_paycrest_order_id: w.provider_order_id!,
                  p_reason: `Polling: ${provider} status=${statusLower}`,
                },
              );
              if (error) {
                console.error(
                  "[Supabase] finalize_withdrawal_failed failed (polling):",
                  error.message,
                );
              } else {
                const finalStatus = ["refunded", "refunding"].includes(
                  statusLower,
                )
                  ? "reversed"
                  : "failed";
                if (finalStatus === "reversed") {
                  await updateWithdrawalStatus(
                    w.provider_order_id!,
                    "reversed",
                  );
                } else {
                  await triggerWithdrawalNotifications(
                    w.provider_order_id!,
                    "failed",
                  );
                }
                console.log(
                  `[Supabase] Polling: Withdrawal ${w.provider_order_id} failed/refunded -> ${finalStatus}`,
                );
                w.status = finalStatus;
              }
            }
          } catch (e) {
            console.error(
              "[Supabase] Failed to auto-update withdrawal status:",
              e,
            );
          }
        }),
      );
    }

    interface JoinedSender {
      email: string;
    }

    const mapTransfer = (
      t: TransferRow & {
        sender?: JoinedSender | JoinedSender[] | null | unknown;
      },
    ) => {
      let senderEmail: string | undefined;
      if (t.sender) {
        if (Array.isArray(t.sender)) {
          senderEmail = (t.sender[0] as JoinedSender)?.email;
        } else {
          senderEmail = (t.sender as JoinedSender)?.email;
        }
      }

      return {
        ...t,
        sender_email: t.sender_email || senderEmail || "Unknown Sender",
        tx_hash: t.tx_hash || (t.note?.startsWith("0x") ? t.note : null),
      };
    };

    return {
      sent: (sent || []).map(mapTransfer),
      received: (received || []).map(mapTransfer),
      deposits: deposits || [],
      withdrawals: withdrawals || [],
      bridges: bridges || [],
    };
  } catch (err) {
    console.error("[Supabase] Failed to fetch activities:", err);
    return {
      sent: [],
      received: [],
      deposits: [],
      withdrawals: [],
      bridges: [],
    };
  }
}

/**
 * Our own ledger's view of an order — what the WEBHOOK has recorded.
 *
 * Provider polling alone cannot see a Bitnob payout complete: we key orders by our `offramp_`
 * reference, which Bitnob's transactions endpoint frequently has no row for, so `getOrder`
 * reports `pending` and relies on the webhook for the terminal state (see BitnobProvider.
 * getOrder). Without this, the UI would sit on "Processing" forever for a payout that had
 * already landed — and, worse, tempt us back into calling a broadcast transfer a success.
 *
 * Read-only and keyed by the caller's own order id.
 */
export async function getLedgerOrderStatus(
  orderId: string,
  txType: "deposit" | "withdrawal",
): Promise<string | null> {
  if (!orderId) return null;
  try {
    const { data } = await supabaseAdmin
      .from(txType === "withdrawal" ? "withdrawals" : "deposits")
      .select("status")
      .eq("provider_order_id", orderId)
      .maybeSingle();
    return data?.status ?? null;
  } catch (e) {
    console.error("[getLedgerOrderStatus] lookup failed:", e);
    return null;
  }
}

// --- ORDER STATUS RECONCILIATION ---
// Use this server action from client-side polling instead of updateWithdrawalStatus() directly.
// For withdrawals, we MUST go through the finalize_withdrawal_success/failed RPCs
// so that locked_balance is updated atomically and audit logs are written.
export async function reconcileOrderStatus(
  orderId: string,
  paycrestStatus: string,
  txType: "deposit" | "withdrawal",
): Promise<{ ok: boolean; newStatus?: string; error?: string }> {
  try {
    const statusLower = paycrestStatus.toLowerCase();

    if (txType === "deposit") {
      if (
        ["settled", "completed", "validated", "deposited"].includes(statusLower)
      ) {
        await updateDepositStatus(orderId, "confirmed");
        return { ok: true, newStatus: "confirmed" };
      } else if (["refunded", "refunding"].includes(statusLower)) {
        await updateDepositStatus(orderId, "reversed");
        return { ok: true, newStatus: "reversed" };
      } else if (["expired", "failed"].includes(statusLower)) {
        await updateDepositStatus(orderId, "failed");
        return { ok: true, newStatus: "failed" };
      }
      return { ok: true }; // intermediate status, no action
    }

    // Withdrawal — always use RPCs, never direct status update
    if (
      ["settled", "completed", "validated", "deposited"].includes(statusLower)
    ) {
      const { data: currentW } = await supabaseAdmin
        .from("withdrawals")
        .select("status")
        .eq("provider_order_id", orderId)
        .maybeSingle();

      if (currentW && currentW.status !== "processing") {
        return { ok: true, newStatus: currentW.status };
      }

      const { error } = await supabaseAdmin.rpc("finalize_withdrawal_success", {
        p_paycrest_order_id: orderId,
      });
      if (error) {
        console.error(
          "[reconcileOrderStatus] finalize_withdrawal_success failed:",
          error.message,
        );
        return { ok: false, error: error.message };
      }
      await triggerWithdrawalNotifications(orderId, "completed");
      return { ok: true, newStatus: "completed" };
    } else if (
      ["refunded", "expired", "failed", "refunding"].includes(statusLower)
    ) {
      const { data: currentW } = await supabaseAdmin
        .from("withdrawals")
        .select("status")
        .eq("provider_order_id", orderId)
        .maybeSingle();

      if (currentW && currentW.status !== "processing") {
        return { ok: true, newStatus: currentW.status };
      }

      const { error } = await supabaseAdmin.rpc("finalize_withdrawal_failed", {
        p_paycrest_order_id: orderId,
        p_reason: `Client polling: Paycrest status=${statusLower}`,
      });
      if (error) {
        console.error(
          "[reconcileOrderStatus] finalize_withdrawal_failed failed:",
          error.message,
        );
        return { ok: false, error: error.message };
      }
      const finalStatus = ["refunded", "refunding"].includes(statusLower)
        ? "reversed"
        : "failed";
      if (finalStatus === "reversed") {
        await updateWithdrawalStatus(orderId, "reversed");
      } else {
        await triggerWithdrawalNotifications(orderId, "failed");
      }
      return { ok: true, newStatus: finalStatus };
    }

    return { ok: true }; // intermediate status, no action
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[reconcileOrderStatus] Unexpected error:", msg);
    return { ok: false, error: msg };
  }
}
