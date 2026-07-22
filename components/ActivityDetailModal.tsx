"use client";

import { format } from "date-fns";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Clock,
  ExternalLink,
  History,
  Landmark,
  MessageSquare,
  Network,
  Receipt,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallets, usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { buildReceiveMessageOnSolanaTx } from "@/lib/circle/solana-gateway";
import bs58 from "bs58";
import { executeReceiveMessage } from "@/lib/web3/bridge-actions";
import { toast } from "sonner";
import { CCTP_DOMAINS, type SupportedChain } from "@/lib/circle/gateway";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

import { Activity } from "./HistoryModule";
import { ReceiptActions } from "./receipt/ReceiptActions";
import { activityToReceiptData } from "@/lib/receipt/utils";
import { getOffRampRate } from "@/lib/actions/ramp";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CHAIN_META } from "@/components/deposit-withdraw/deposit-shared";

const ACTIVITY_LABELS: Record<string, string> = {
  sent: "Transfer Sent",
  received: "Funds Received",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  bridge: "Bridge Transfer",
};

const EXPLORER_BASE_URL = "https://basescan.org/tx/";

const chainLabel = (chain: string) =>
  (CHAIN_META[chain.toLowerCase()]?.name ?? chain).toUpperCase();

const explorerFor = (chain: string | undefined, hash: string) =>
  (chain ? CHAIN_META[chain.toLowerCase()] : null)?.explorerTx(hash) ??
  `${EXPLORER_BASE_URL}${hash}`;

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
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const [isClaiming, setIsClaiming] = useState(false);

  const handleClaim = async () => {
    if (!activity?.txHash) return;
    setIsClaiming(true);
    try {
      const embeddedWallet = wallets.find(
        (w) => w.walletClientType === "privy",
      );
      if (!embeddedWallet) {
        toast.error("Embedded wallet not found. Please log in.");
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
        toast.error("Invalid bridge source chain.");
        setIsClaiming(false);
        return;
      }

      // ── Fast path: already minted, just update DB and refresh ───────────
      if (activity.mintTxHash) {
        toast.info("This bridge was already completed. Refreshing status...");
        await fetch("/api/bridge/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            burnTxHash: activity.txHash,
            mintTxHash: activity.mintTxHash,
          }),
        }).catch(() => {});
        toast.success("Bridge marked complete!");
        setTimeout(() => window.location.reload(), 800);
        return;
      }

      // ── Fetch attestation from Circle (DB-cached by status route) ────────
      toast.info("Checking bridge status...");
      const res = await fetch(
        `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${sourceChain}`,
      );
      if (!res.ok) throw new Error(`Status API error: ${res.statusText}`);
      const data = await res.json();

      console.log("[Manual Claim] Attestation status:", data);

      if (!data || data.status === "not_found") {
        toast.error(
          "Bridge transaction not found on Circle. Please check the transaction hash.",
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
          ? "Block finality almost reached — nearly there."
          : "Waiting for block confirmations on the source chain.";
        toast.error(
          `${chainLabel} bridge is still being verified. ${detail} Try again in ${wait}.`,
          { duration: 8000 },
        );
        setIsClaiming(false);
        return;
      }

      if (data.status !== "complete") {
        toast.error("Bridge is still processing. Please try again shortly.");
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
              "Attestation data incomplete. Please try again in 30 seconds.",
            );
          }
          // Check if Circle's relayer already minted before trying manually
          toast.info("Finalising bridge on destination chain...");
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
          toast.info("Claiming USDC on Stellar (gas paid by sponsor)...");
          const claimRes = await fetch("/api/stellar/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: activity.txHash, sourceChain }),
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
          toast.info("Claiming USDC on Solana...");

          const solAccount = user?.linkedAccounts.find(
            (a) =>
              a.type === "wallet" &&
              (a as { walletClientType?: string }).walletClientType ===
                "privy" &&
              (a as { chainType?: string }).chainType === "solana",
          );
          const solAddress =
            solAccount && "address" in solAccount
              ? (solAccount as { address: string }).address
              : undefined;

          const solWallet = solAddress
            ? solanaWallets.find((w) => w.address === solAddress)
            : null;
          if (!solWallet || !solAddress) {
            throw new Error(
              "Solana wallet not found. Please link a Solana wallet first.",
            );
          }

          const walletPubkey = new PublicKey(solAddress);
          const solConn = new Connection(SOLANA_RPC, "confirmed");

          const { transaction } = await buildReceiveMessageOnSolanaTx(
            solConn,
            walletPubkey,
            data.messageBytes!,
            data.attestation!,
          );

          // 1. Sponsor transaction
          const txBase64 = transaction
            .serialize({ requireAllSignatures: false, verifySignatures: false })
            .toString("base64");
          const sponsorRes = await fetch("/api/bridge/solana-sponsor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transaction: txBase64 }),
          });
          if (!sponsorRes.ok) {
            const errData = await sponsorRes.json().catch(() => ({}));
            throw new Error(
              errData.error || "Failed to sponsor Solana claim transaction",
            );
          }
          const { sponsoredTransaction } = await sponsorRes.json();
          const sponsoredTx = Transaction.from(
            Buffer.from(sponsoredTransaction, "base64"),
          );

          toast.info("Please approve the popup to claim USDC on Solana.");
          // 2. Sign transaction
          const { signedTransaction: signedBytes } = await signTransaction({
            transaction: sponsoredTx.serialize({ requireAllSignatures: false }),
            wallet: solWallet,
          });

          // 3. Broadcast transaction
          const signature = await solConn.sendRawTransaction(signedBytes, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });

          const lb = await solConn.getLatestBlockhash();
          await solConn.confirmTransaction(
            {
              signature,
              blockhash: lb.blockhash,
              lastValidBlockHeight: lb.lastValidBlockHeight,
            },
            "confirmed",
          );
          mintTxHash = signature;
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

      toast.success("USDC claimed successfully!");
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      // Always log full technical error to console for debugging
      console.error("[Manual Claim] Full error object:", err);
      const rawMsg = err instanceof Error ? err.message : String(err);
      const lowerMsg = rawMsg.toLowerCase();
      console.error("[Manual Claim] Error message:", rawMsg);

      // "Nonce already used" — the MessageTransmitter has already processed this transfer.
      // The USDC was minted on-chain. Check the smart account balance or refresh.
      if (
        lowerMsg.includes("nonce already used") ||
        lowerMsg.includes("message already received") ||
        lowerMsg.includes("message already processed")
      ) {
        // Circle's relayer already minted — re-poll to get the forwardTxHash
        toast.info("Your USDC has already been delivered. Saving mint hash...");
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
      } else if (
        lowerMsg.includes("user rejected") ||
        lowerMsg.includes("user denied") ||
        lowerMsg.includes("rejected the request")
      ) {
        toast.info("Transaction cancelled. You can try again.");
      } else if (
        lowerMsg.includes("pending") ||
        lowerMsg.includes("still finalizing") ||
        lowerMsg.includes("not yet available")
      ) {
        toast.error(
          "Circle is still processing this transfer. Please wait 1-2 minutes and try again.",
        );
      } else if (
        lowerMsg.includes("no accounts") ||
        lowerMsg.includes("wallet not ready")
      ) {
        toast.error(
          "Your wallet is still loading. Please wait a moment and try again.",
        );
      } else {
        console.error("[Manual Claim Modal] Raw error:", rawMsg);
        const displayMsg = rawMsg
          .replace(/0x[0-9a-fA-F]{20,}/g, "[hex]")
          .slice(0, 200);
        toast.error(
          displayMsg ||
            "Claim could not be completed right now. Please try again.",
        );
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

  const isSuccess =
    activity.status.toLowerCase() === "settled" ||
    activity.status.toLowerCase() === "completed" ||
    activity.status.toLowerCase() === "confirmed" ||
    activity.status.toLowerCase() === "success" ||
    activity.status.toLowerCase() === "complete";

  // Network / route line.
  const networkValue =
    activity.type === "bridge" && activity.sourceChain
      ? `${chainLabel(activity.sourceChain)} → ${chainLabel(activity.destChain ?? "base")}`
      : activity.type === "withdrawal" && activity.consolidated
        ? `YOUR NETWORKS → ${chainLabel(activity.sourceChain ?? "base")}`
        : activity.sourceChain
          ? chainLabel(activity.sourceChain)
          : null;

  const viewFullDetails = () => {
    onClose();
    router.push(`/dashboard/activity/${activity.id}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm p-0 overflow-hidden">
        <DialogTitle className="sr-only">
          {activity ? ACTIVITY_LABELS[activity.type] : "Activity Detail"}
        </DialogTitle>

        <div className="p-8 text-center space-y-8">
          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-4xl flex items-center justify-center shadow-2xl relative group"
              style={{
                background: isSuccess
                  ? "rgba(0, 232, 122, 0.1)"
                  : activity.type === "sent"
                    ? "rgba(248, 113, 113, 0.1)"
                    : activity.type === "received"
                      ? "rgba(0, 232, 122, 0.1)"
                      : activity.type === "deposit"
                        ? "rgba(59, 130, 246, 0.1)"
                        : activity.type === "bridge"
                          ? "rgba(96, 165, 250, 0.1)"
                          : "rgba(251, 146, 60, 0.1)",
                color: isSuccess
                  ? "#00e87a"
                  : activity.type === "sent"
                    ? "#f87171"
                    : activity.type === "received"
                      ? "#00e87a"
                      : activity.type === "deposit"
                        ? "#3b82f6"
                        : activity.type === "bridge"
                          ? "#60a5fa"
                          : "#fb923c",
                border: `1px solid ${
                  isSuccess
                    ? "rgba(0, 232, 122, 0.2)"
                    : activity.type === "sent"
                      ? "rgba(248, 113, 113, 0.2)"
                      : activity.type === "received"
                        ? "rgba(0, 232, 122, 0.2)"
                        : activity.type === "deposit"
                          ? "rgba(59, 130, 246, 0.2)"
                          : activity.type === "bridge"
                            ? "rgba(96, 165, 250, 0.2)"
                            : "rgba(251, 146, 60, 0.2)"
                }`,
              }}
            >
              <div className="absolute inset-0 rounded-4xl blur-xl opacity-20 bg-current group-hover:opacity-40 transition-opacity" />
              {activity.type === "sent" && (
                <ArrowUpRight className="w-10 h-10 relative z-10" />
              )}
              {activity.type === "received" && (
                <ArrowDownLeft className="w-10 h-10 relative z-10" />
              )}
              {activity.type === "deposit" && (
                <Wallet className="w-10 h-10 relative z-10" />
              )}
              {activity.type === "withdrawal" && (
                <Landmark className="w-10 h-10 relative z-10" />
              )}
              {activity.type === "bridge" && (
                <RefreshCw className="w-10 h-10 relative z-10" />
              )}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
              {ACTIVITY_LABELS[activity.type]}
            </p>
            <h3 className="font-display text-4xl font-bold tracking-tighter text-brand-secondary">
              {activity.amount.toLocaleString()}{" "}
              <span className="text-lg opacity-30 font-bold uppercase">
                {activity.asset}
              </span>
            </h3>
            <div className="flex justify-center mt-3">
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-white/4 border border-white/8 text-brand-secondary/60">
                {activity.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left">
            <div className="p-4 rounded-2xl bg-white/2 border border-white/4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                <Clock className="w-3 h-3" /> Timestamp
              </p>
              <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                {format(new Date(activity.timestamp), "MMMM dd, yyyy @ HH:mm")}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/2 border border-white/4">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                <History className="w-3 h-3" /> Details
              </p>
              <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                {activity.details}
              </p>
            </div>

            {networkValue && (
              <div className="p-4 rounded-2xl bg-white/2 border border-white/4">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                  <Network className="w-3 h-3" />{" "}
                  {activity.type === "bridge" ||
                  (activity.type === "withdrawal" && activity.consolidated)
                    ? "Route"
                    : "Network"}
                </p>
                <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                  {networkValue}
                </p>
              </div>
            )}

            {activity.note && (
              <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-accent">
                  <MessageSquare className="w-3 h-3" /> Memo
                </p>
                <p className="text-sm font-medium leading-relaxed text-brand-secondary/80">
                  {activity.note}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/20 text-center flex items-center justify-center gap-2">
              <Receipt className="w-3 h-3" /> Receipt
            </p>
            <ReceiptActions
              data={(() => {
                const base = activityToReceiptData(activity);
                if (
                  activity.type === "withdrawal" &&
                  base.fiatPayoutAmount == null &&
                  estimatedFiatRate
                ) {
                  return {
                    ...base,
                    fiatPayoutAmount: Math.round(
                      activity.amount * estimatedFiatRate,
                    ),
                    exchangeRate: estimatedFiatRate,
                  };
                }
                return base;
              })()}
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              {activity.type === "bridge" ? (
                <>
                  {activity.txHash && (
                    <a
                      href={explorerFor(activity.sourceChain, activity.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Burn Tx
                    </a>
                  )}

                  {activity.mintTxHash ? (
                    <a
                      href={explorerFor(
                        activity.destChain ?? "base",
                        activity.mintTxHash,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Mint Tx
                    </a>
                  ) : activity.status === "complete" &&
                    Date.now() - new Date(activity.timestamp).getTime() <
                      10 * 60 * 1000 ? (
                    // Completed very recently — Circle's relayer handled the mint, hash saving in progress
                    <div className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      ✓ Completed
                    </div>
                  ) : (
                    <button
                      onClick={handleClaim}
                      disabled={isClaiming}
                      className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-accent text-background border border-accent hover:opacity-90 outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50"
                    >
                      {isClaiming ? "Claiming..." : "Claim USDC"}
                    </button>
                  )}
                </>
              ) : (
                activity.txHash && (
                  <a
                    href={explorerFor(activity.sourceChain, activity.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Explorer
                  </a>
                )
              )}
            </div>

            <button
              onClick={viewFullDetails}
              className="btn-accent w-full h-12 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 outline-none focus:ring-2 focus:ring-accent/50"
            >
              View Full Details <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="w-full h-12 rounded-xl text-[10px] font-bold uppercase tracking-widest bg-white/5 border border-white/8 text-brand-secondary/60 hover:bg-white/10 transition-all outline-none focus:ring-2 focus:ring-accent/50"
            >
              Close
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
