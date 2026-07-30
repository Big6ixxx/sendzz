"use client";

/**
 * PendingBridgeClaims
 *
 * Every bridge is a burn followed by a claim. The burn is irreversible, so when the
 * claim leg doesn't land — a closed tab, a declined signature, a destination wallet
 * that wasn't ready to receive — the USDC is real, already burned, and invisible in
 * every balance until someone finishes the second half.
 *
 * This panel is where those show up. CCTP attestations don't expire, so a claim
 * listed here stays valid indefinitely and can be retried as many times as needed.
 */

import { claimBridgeOnDestination, type SolanaTxSigner } from "@/lib/web3/bridge-claim";
import { classifyAppError } from "@/lib/errors/appErrors";
import { getPendingBridgeClaims } from "@/lib/supabase/transactions";
import { CHAIN_NAMES } from "@/lib/circle/gateway";
import { cn } from "@/lib/utils";
import type { PendingBridgeClaim } from "@/types/bridge";
import { Connection } from "@solana/web3.js";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CircleDollarSign, Clock, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const CHAIN_LABELS: Record<string, string> = {
  ...CHAIN_NAMES,
  solana: "Solana",
  stellar: "Stellar",
};

const label = (chain: string) =>
  CHAIN_LABELS[chain] ?? chain.charAt(0).toUpperCase() + chain.slice(1);

interface PendingBridgeClaimsProps {
  userEmail: string;
  solanaAddress?: string;
  stellarWallet?: { walletId: string; address: string } | null;
}

export function PendingBridgeClaims({
  userEmail,
  solanaAddress,
  stellarWallet,
}: PendingBridgeClaimsProps) {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const queryClient = useQueryClient();
  const solConn = useRef(new Connection(SOLANA_RPC, "confirmed"));

  const [claimingId, setClaimingId] = useState<string | null>(null);

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const privySolAccount = user?.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      a.walletClientType === "privy" &&
      a.chainType === "solana",
  );
  const privySolanaAddress =
    privySolAccount && "address" in privySolAccount
      ? (privySolAccount as { address: string }).address
      : solanaAddress;
  const embeddedSolWallet =
    solanaWallets.find((w) => w.address === privySolanaAddress) ?? null;

  const { data: claims = [], refetch } = useQuery<PendingBridgeClaim[]>({
    queryKey: ["pending-bridge-claims", userEmail],
    queryFn: () => getPendingBridgeClaims(userEmail),
    enabled: !!userEmail,
    refetchInterval: 20_000,
  });

  const handleClaim = async (claim: PendingBridgeClaim) => {
    setClaimingId(claim.id);
    try {
      // The server signer grant is owned by useStellarWallet and is already in place by
      // the time `stellarWallet` is populated — re-granting here would just make Privy
      // reject a duplicate. If it somehow isn't granted, the claim route says so.
      const signSolanaTx: SolanaTxSigner = async (tx) => {
        const { signedTransaction } = await signTransaction({
          transaction: tx.serialize({ requireAllSignatures: false }),
          wallet: embeddedSolWallet!,
        });
        return signedTransaction as Uint8Array;
      };

      const mintTxHash = await claimBridgeOnDestination({
        destChain: claim.destChain,
        sourceChain: claim.sourceChain,
        burnTxHash: claim.burnTxHash,
        messageBytes: claim.messageBytes ?? "",
        attestation: claim.attestation ?? "",
        connection: solConn.current,
        embeddedWallet,
        solanaWallet: embeddedSolWallet,
        signSolanaTx,
        stellarWallet,
      });

      await fetch("/api/bridge/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnTxHash: claim.burnTxHash, mintTxHash }),
      }).catch(console.error);

      toast.success(`Claimed! ${claim.amount} USDC is now on ${label(claim.destChain)}.`);
      await settle();
    } catch (err) {
      const classified = classifyAppError(err);
      if (classified.isAlreadyProcessed) {
        // The mint landed elsewhere (relayer, another tab) — reconcile and move on.
        await fetch("/api/bridge/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ burnTxHash: claim.burnTxHash }),
        }).catch(console.error);
        toast.success("This transfer has already arrived. Refreshing your balance...");
        await settle();
      } else if (!classified.isSilent) {
        toast.error(classified.message);
      }
    } finally {
      setClaimingId(null);
    }
  };

  const settle = async () => {
    await refetch();
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
    queryClient.invalidateQueries({ queryKey: ["history"] });
  };

  if (claims.length === 0) return null;

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {claims.map((claim) => {
          const isClaiming = claimingId === claim.id;
          const needsSolWallet = claim.destChain === "solana" && !embeddedSolWallet;
          const disabled = !claim.ready || isClaiming || !!claimingId || needsSolWallet;

          return (
            <motion.div
              key={claim.id}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="card-glass p-6 border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-yellow-500/5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 h-fit">
                    {claim.ready ? (
                      <CircleDollarSign className="w-6 h-6" />
                    ) : (
                      <Clock className="w-6 h-6" />
                    )}
                  </div>
                  <div className="space-y-1 text-left">
                    <h4 className="text-[10px] font-bold text-amber-400 uppercase tracking-[0.2em]">
                      Unclaimed Transfer
                    </h4>
                    <p className="text-lg font-bold text-white tracking-tight">
                      {claim.amount} USDC · {label(claim.sourceChain)} →{" "}
                      {label(claim.destChain)}
                    </p>
                    <p className="text-xs text-white/40 font-medium">
                      {claim.ready
                        ? `Your USDC was burned on ${label(claim.sourceChain)} and is waiting to be claimed on ${label(claim.destChain)}. No gas required.`
                        : "Circle is still verifying this transfer. It will become claimable in 1–2 minutes."}
                    </p>
                    {needsSolWallet && (
                      <p className="text-xs text-amber-400/70 font-medium">
                        Your Solana wallet is still loading.
                      </p>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleClaim(claim)}
                  disabled={disabled}
                  className={cn(
                    "h-12 px-6 rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center gap-2 justify-center shrink-0",
                    disabled
                      ? "bg-white/5 border border-white/10 text-white/25 cursor-not-allowed"
                      : "bg-amber-500 hover:bg-amber-400 text-black cursor-pointer",
                  )}
                >
                  {isClaiming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Claiming
                    </>
                  ) : claim.ready ? (
                    <>
                      Claim {claim.amount} USDC
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
