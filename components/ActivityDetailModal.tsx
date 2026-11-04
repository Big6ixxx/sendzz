"use client";

import { format } from "date-fns";
import { ArrowRight, Copy, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import { executeReceiveMessage } from "@/lib/web3/bridge-actions";
import { claimBridgeOnDestination } from "@/lib/web3/bridge-claim";
import { privySolanaAddress } from "@/lib/solana/privy-address";
import { toast } from "sonner";
import { CCTP_DOMAINS, type SupportedChain } from "@/lib/circle/gateway";
import { classifyAppError } from "@/lib/errors/appErrors";
import { explorerTxUrl, HOME_CHAIN, isPlaceholderHash } from "@/lib/explorers";
import { Activity } from "./HistoryModule";
import { ReceiptActions } from "./receipt/ReceiptActions";
import { activityToReceiptData } from "@/lib/receipt/utils";
import { getOffRampRate } from "@/lib/actions/ramp";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CHAIN_META } from "@/components/deposit-withdraw/deposit-shared";
import { ACTIVITY_LOOK, activityStatus, detailHasIdentifier, shortenDetail } from "@/components/dashboard/activity-look";
import { formatMoney } from "@/lib/format-usdc";
import { FlowLabel } from "@/components/flow/ui";

const ACTIVITY_LABELS: Record<string, string> = {
  sent: "Transfer Sent",
  received: "Funds Received",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  bridge: "Bridge Transfer",
};

const chainLabel = (chain: string) =>
  (CHAIN_META[chain.toLowerCase()]?.name ?? chain).toUpperCase();

// Transfers don't persist their chain yet, so an unknown chain means the home chain.
const explorerFor = (chain: string | undefined, hash: string | null | undefined) =>
  explorerTxUrl(chain ?? HOME_CHAIN, hash) ?? undefined;

interface ActivityDetailModalProps {
  activity: Activity | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Compact activity summary shown from the dashboard's Recent Activity. Surfaces the key
 * facts + a receipt, with a "View full details" action that opens the full transaction
 * page (/dashboard/activity/[id]) for the complete breakdown.
 */
export function ActivityDetailModal({
  activity,
  isOpen,
  onClose,
}: ActivityDetailModalProps) {
  const router = useRouter();
  const [prevActivityId, setPrevActivityId] = useState<string | null>(null);
  const [estimatedFiatRate, setEstimatedFiatRate] = useState<number | null>(
    null,
  );

  const { wallets } = useWallets();
  const { user } = usePrivy();
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = async () => {
    if (!activity?.txHash) return;
    setIsClaiming(true);
    try {
      const embeddedWallet = wallets.find(
        (w) => w.walletClientType === "privy",
      );
      if (!embeddedWallet) {
        toast.error("Your wallet isn't ready yet. Please sign in again.");
        setIsClaiming(false);
        return;
      }

      const sourceChain = activity.sourceChain?.toLowerCase();
      const destChain = activity.destChain?.toLowerCase() as SupportedChain;

      let domain: number | null = null;
      if (sourceChain === "solana") domain = 5;
      else if (sourceChain === "stellar") domain = 27;
      else if (sourceChain && sourceChain in CCTP_DOMAINS) {
        domain = CCTP_DOMAINS[sourceChain as keyof typeof CCTP_DOMAINS];
      }

      if (domain === null) {
        toast.error("We couldn't tell which network this came from.");
        setIsClaiming(false);
        return;
      }

      // ── Fast path: already minted, just update DB and refresh ───────────
      if (activity.mintTxHash) {
        toast.info("This already arrived. Refreshing…");
        await fetch("/api/bridge/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            burnTxHash: activity.txHash,
            mintTxHash: activity.mintTxHash,
          }),
        }).catch(() => {});
        toast.success("All done.");
        setTimeout(() => window.location.reload(), 800);
        return;
      }

      // ── Fetch attestation from Circle (DB-cached by status route) ────────
      toast.info("Checking on your transfer…");
      const res = await fetch(
        `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${sourceChain}`,
      );
      if (!res.ok) throw new Error(`Status API error: ${res.statusText}`);
      const data = await res.json();

      console.log("[Manual Claim] Attestation status:", data);

      if (!data || data.status === "not_found") {
        toast.error(
          "Bridge transaction not found on-chain. Please check the transaction hash.",
        );
        setIsClaiming(false);
        return;
      }

      if (
        data.status === "pending" ||
        data.status === "pending_confirmations"
      ) {
        const chainLabel = sourceChain
          ? sourceChain.charAt(0).toUpperCase() + sourceChain.slice(1)
          : "source chain";
        const isPendingConfirmations = data.status === "pending_confirmations";
        const wait = isPendingConfirmations ? "1–2 minutes" : "2–5 minutes";
        const detail = isPendingConfirmations
          ? "Almost there, the network is nearly done confirming."
          : "Waiting for block confirmations on the source chain.";
        toast.error(
          `${chainLabel} bridge is still being verified. ${detail} Try again in ${wait}.`,
          { duration: 8000 },
        );
        setIsClaiming(false);
        return;
      }

      if (data.status !== "complete") {
        toast.error("Still on its way. Try again in a moment.");
        setIsClaiming(false);
        return;
      }

      let mintTxHash = data.mintTxHash || null;
      console.log(
        "[Manual Claim] Extracted mintTxHash from Circle relayer:",
        mintTxHash,
      );

      const isEvmDest = destChain && destChain in CCTP_DOMAINS;
      if (isEvmDest) {
        if (!mintTxHash) {
          if (!data.messageBytes || !data.attestation) {
            throw new Error(
              "Not quite ready yet. Try again in 30 seconds.",
            );
          }
          // Check if Circle's relayer already minted before trying manually
          toast.info("Delivering your money…");
          await new Promise((r) => setTimeout(r, 3000));
          const recheckRes = await fetch(
            `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${sourceChain}`,
          );
          const recheckData = await recheckRes.json().catch(() => ({}));
          if (recheckData.mintTxHash) {
            mintTxHash = recheckData.mintTxHash;
          } else {
            mintTxHash = await executeReceiveMessage(
              embeddedWallet,
              data.messageBytes,
              data.attestation,
              destChain,
            );
          }
        }
      } else if ((destChain as string) === "stellar") {
        if (!mintTxHash) {
          console.log(
            "[Manual Claim] Stellar destination — server-side claim...",
          );
          toast.info("Delivering your money on Stellar. We cover the network fee.");

          // Resolve the user's Stellar wallet so the claim can add the USDC trustline
          // if it's missing — without it `mint_and_forward` reverts on the transfer leg.
          let stellarWallet: { walletId?: string; address?: string } = {};
          if (user?.id && user?.email?.address) {
            stellarWallet = await fetch("/api/stellar/provision", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              // An explicit claim: activating here (trustline included) is what lets it land.
              body: JSON.stringify({ privyUserId: user.id, activate: true }),
            })
              .then((r) => (r.ok ? r.json() : {}))
              .catch(() => ({}));
          }

          const claimRes = await fetch("/api/stellar/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txHash: activity.txHash,
              sourceChain,
              walletId: stellarWallet.walletId,
              stellarAddress: stellarWallet.address,
            }),
          });
          if (!claimRes.ok) {
            const claimErr = await claimRes.json();
            throw new Error(claimErr.error || "Failed to claim on Stellar");
          }
          const claimData = await claimRes.json();
          mintTxHash = claimData.txHash;
          console.log(
            "[Manual Claim] Stellar claim complete. Mint tx hash:",
            mintTxHash,
          );
        } else {
          console.log("[Manual Claim] Stellar already minted:", mintTxHash);
        }
      } else if ((destChain as string) === "solana") {
        if (!mintTxHash) {
          console.log(
            "[Manual Claim Modal] Solana destination - initiating client-side receiveMessage...",
          );
          toast.info("Delivering your money on Solana…");

          // Only the address is needed — the server signs — so read it from Privy rather than
          // waiting on the Solana wallets hook.
          const solAddress = privySolanaAddress(user);
          if (!solAddress) {
            throw new Error(
              "Solana wallet not found. Please link a Solana wallet first.",
            );
          }
          mintTxHash = await claimBridgeOnDestination({
            destChain: "solana",
            sourceChain: activity.sourceChain,
            burnTxHash: activity.txHash,
            messageBytes: data.messageBytes,
            attestation: data.attestation,
            solanaWallet: { address: solAddress },
          });
          console.log(
            "[Manual Claim] Solana claim complete. Mint tx hash:",
            mintTxHash,
          );
        } else {
          console.log("[Manual Claim] Solana already minted:", mintTxHash);
        }
      } else {
        console.log(
          "[Manual Claim] Non-EVM/Non-Stellar/Non-Solana destination — Circle relayer will process.",
        );
      }

      // ── Persist the result ────────────────────────────────────────────────
      await fetch("/api/bridge/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnTxHash: activity.txHash, mintTxHash }),
      }).catch(() => {});

      toast.success("Your money has arrived.");
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      // classifyAppError logs the full error and returns a message that is always safe
      // to display — raw chain output must never reach the toast.
      const classified = classifyAppError(err);

      // The MessageTransmitter has already processed this transfer: the USDC was minted
      // on-chain, so reconcile our record rather than reporting a failure.
      if (classified.isAlreadyProcessed) {
        // Circle's relayer already minted — re-poll to get the forwardTxHash
        toast.info("This already arrived. Updating your history…");
        try {
          const retryRes = await fetch(
            `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${activity.sourceChain?.toLowerCase()}`,
          );
          const retryData = await retryRes.json().catch(() => ({}));
          const relayedHash = retryData.mintTxHash || null;
          await fetch("/api/bridge/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              burnTxHash: activity.txHash,
              mintTxHash: relayedHash,
            }),
          }).catch(() => {});
        } catch {
          await fetch("/api/bridge/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ burnTxHash: activity.txHash }),
          }).catch(() => {});
        }
        setTimeout(() => window.location.reload(), 800);
      } else if (classified.isSilent) {
        toast.info("Cancelled. You can try again whenever you like.");
      } else {
        toast.error(classified.message);
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // Adjust state during render if activity changes to prevent cascading renders in useEffect
  const currentActivityId = activity?.id || null;
  if (currentActivityId !== prevActivityId) {
    setPrevActivityId(currentActivityId);
    setEstimatedFiatRate(null);
  }

  const activityId = activity?.id;
  const activityType = activity?.type;
  const activityFiatAmount = activity?.fiatAmount;
  const activityFiatCurrency = activity?.fiatCurrency;

  // For old withdrawal records that predate fiat_amount being saved, fetch the
  // current off-ramp rate so the receipt can show an approximate fiat payout.
  useEffect(() => {
    if (
      !activityId ||
      activityType !== "withdrawal" ||
      activityFiatAmount != null
    ) {
      return;
    }
    let active = true;
    const currency = activityFiatCurrency || "NGN";
    getOffRampRate(currency)
      .then((rate) => {
        if (active) setEstimatedFiatRate(rate);
      })
      .catch(() => {
        if (active) setEstimatedFiatRate(null);
      });
    return () => {
      active = false;
    };
  }, [activityId, activityType, activityFiatAmount, activityFiatCurrency]);

  if (!activity) return null;

  // Network / route line.
  const networkValue =
    activity.type === "bridge" && activity.sourceChain
      ? `${chainLabel(activity.sourceChain)} → ${chainLabel(activity.destChain ?? "base")}`
      : activity.sourceChain
        ? chainLabel(activity.sourceChain)
        : null;

  const viewFullDetails = () => {
    onClose();
    router.push(`/dashboard/activity/${activity.id}`);
  };

  const look = ACTIVITY_LOOK[activity.type] ?? ACTIVITY_LOOK.sent;
  // Settled reads as done; anything else names its real state.
  const status = activityStatus(activity.status) ?? { text: "Completed", tone: "bg-[var(--lp-green)]/15 text-[var(--lp-good)]" };
  const receiptData = (() => {
    const base = activityToReceiptData(activity);
    if (activity.type === "withdrawal" && base.fiatPayoutAmount == null && estimatedFiatRate) {
      return { ...base, fiatPayoutAmount: Math.round(activity.amount * estimatedFiatRate), exchangeRate: estimatedFiatRate };
    }
    return base;
  })();
  const pill =
    "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-[rgb(var(--lp-hair)/0.15)] bg-[var(--lp-surface)] px-4 text-[14px] font-semibold transition-colors hover:border-[var(--lp-ink)]";
  const rows = [
    { label: "When", value: format(new Date(activity.timestamp), "d MMM yyyy, HH:mm") },
    // Cut to one row: a full address, hash or long email would push the dialog past the screen.
    // The whole value is on hover, and a tap copies it.
    {
      label: "Details",
      value: shortenDetail(activity.details),
      full: activity.details,
      copyable: detailHasIdentifier(activity.details),
    },
    ...(networkValue
      ? [{ label: activity.type === "bridge" || (activity.type === "withdrawal" && activity.consolidated) ? "Route" : "Network", value: networkValue }]
      : []),
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="grid-cols-[minmax(0,1fr)] gap-0 p-0 sm:max-w-[440px] max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:max-w-none max-sm:w-full max-sm:rounded-b-none"
      >
        <DialogTitle className="sr-only">{ACTIVITY_LABELS[activity.type] ?? "Activity"}</DialogTitle>

        <div className="min-w-0 p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2.5">
              <span className={`grid size-10 place-items-center rounded-full ${look.badge}`}>
                <look.icon className="size-[18px]" />
              </span>
              <FlowLabel as="span">{ACTIVITY_LABELS[activity.type] ?? look.label}</FlowLabel>
            </span>
            <button
              onClick={onClose}
              aria-label="Close"
              className="lp-card grid size-10 place-items-center rounded-full outline-none transition-[scale] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--lp-ink)] active:scale-[0.94]"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="mt-6">
            <p className="lp-display break-words text-[clamp(40px,11vw,56px)] leading-[0.92] tracking-[-0.05em] tabular-nums">
              {look.sign}
              {formatMoney(activity.amount)}{" "}
              <span className="lp-serif text-[0.45em] tracking-[-0.01em] text-[var(--lp-muted)]">{activity.asset}</span>
            </p>
            <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold ${status.tone}`}>
              {status.text}
            </span>
          </div>

          <dl className="lp-card mt-6 rounded-[22px] px-5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 border-b border-[var(--lp-soft-2)] py-3.5 last:border-b-0">
                <dt className="shrink-0 text-[14px] text-[var(--lp-muted)]">{r.label}</dt>
                <dd className="flex min-w-0 items-center justify-end gap-1.5 text-[15px] font-semibold">
                  {"copyable" in r && r.copyable ? (
                    <button
                      type="button"
                      title={r.full}
                      onClick={() => {
                        navigator.clipboard.writeText(r.full);
                        toast.success("Copied");
                      }}
                      className="-mr-2 flex min-w-0 items-center gap-1.5 rounded-[12px] px-2 py-0.5 transition-colors hover:bg-[var(--lp-cream)]"
                    >
                      <span className="line-clamp-3 break-words text-right">{r.value}</span>
                      <Copy className="size-3.5 shrink-0 text-[var(--lp-muted)]" />
                    </button>
                  ) : (
                    <span className="line-clamp-3 break-words text-right" title={"full" in r ? r.full : r.value}>
                      {r.value}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {activity.note && (
            <div className="mt-3 rounded-[22px] bg-[var(--lp-green)]/12 px-5 py-4">
              <p className="text-[13px] text-[var(--lp-good)]">Memo</p>
              <p className="mt-0.5 break-words text-[15px] leading-[1.5] [overflow-wrap:anywhere]">{activity.note}</p>
            </div>
          )}

          <div className="mt-5">
            <ReceiptActions data={receiptData} />
          </div>

          <div className="mt-3 flex gap-2">
            {activity.type === "bridge" ? (
              <>
                {activity.txHash && !isPlaceholderHash(activity.txHash) && (
                  <a href={explorerFor(activity.sourceChain, activity.txHash)} target="_blank" rel="noopener noreferrer" className={pill}>
                    <ExternalLink className="size-4" /> Sent from
                  </a>
                )}
                {(() => {
                  const hasValidMint = !!activity.mintTxHash && explorerFor(activity.destChain ?? "base", activity.mintTxHash) !== undefined;
                  if (hasValidMint) {
                    return (
                      <a href={explorerFor(activity.destChain ?? "base", activity.mintTxHash)} target="_blank" rel="noopener noreferrer" className={pill}>
                        <ExternalLink className="size-4" /> Arrived on
                      </a>
                    );
                  }
                  // Delivered, but with no transaction to link to: delivery was confirmed by reading
                  // the destination chain rather than by watching our own claim land. Said rather
                  // than left blank, which reads as a transfer that never finished.
                  if (activity.status === "complete") {
                    return (
                      <p className="flex flex-1 items-center justify-center rounded-full bg-[var(--lp-green)]/12 px-4 py-2 text-center text-[13px] text-[var(--lp-good)]">
                        Delivered on {chainLabel(activity.destChain ?? "base")}
                      </p>
                    );
                  }
                  return (
                    <button
                      onClick={handleClaim}
                      disabled={isClaiming}
                      className="lp-on-green inline-flex h-11 flex-1 items-center justify-center rounded-full px-4 text-[14px] font-semibold text-[var(--lp-ink)] transition-[scale,opacity] duration-150 active:scale-[0.97] disabled:opacity-50"
                    >
                      {isClaiming ? "Claiming…" : "Claim USDC"}
                    </button>
                  );
                })()}
              </>
            ) : (
              activity.txHash && (
                <a href={explorerFor(activity.sourceChain, activity.txHash)} target="_blank" rel="noopener noreferrer" className={pill}>
                  <ExternalLink className="size-4" /> View on explorer
                </a>
              )
            )}
          </div>

          <button
            onClick={viewFullDetails}
            className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[var(--lp-ink)] px-5 text-[15px] font-semibold text-[var(--lp-cream)] transition-[scale] duration-150 active:scale-[0.98]"
          >
            View full details <ArrowRight className="size-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
