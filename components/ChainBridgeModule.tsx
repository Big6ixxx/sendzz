"use client";

/**
 * ChainBridgeModule — move USDC between the user's own networks.
 *
 * Unlike SmartBridgeModule (which only consolidates idle funds onto Base), this lets
 * the user pick BOTH the source and destination chain and bridge between them via
 * Circle CCTP V2. The mint recipient is the user's own smart account (for EVM) or
 * Stellar address. Gasless on both legs (burn + mint sponsored by circle/relayer).
 */

import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
import { formatFeeSummary } from "@/lib/format-usdc";
import { usePlatformFeePercent } from "@/lib/hooks/usePlatformFeePercent";
import { quoteFee } from "@/lib/actions/fees";
import { parseAppError } from "@/lib/errors/appErrors";
import { MONITOR_MAX_ATTEMPTS, MONITOR_POLL_MS } from "@/lib/web3/bridge-timing";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CHAIN_NAMES, isBridgeable, type SupportedChain } from "@/lib/circle/gateway";
import { EVM_CHAINS } from "@/lib/web3/routing";
import { executeSmartBridge } from "@/lib/web3/bridge-actions";
import { prepareSolanaBurnTx } from "@/lib/web3/solana-bridge";
import { claimBridgeOnDestination } from "@/lib/web3/bridge-claim";
import { classifyAppError } from "@/lib/errors/appErrors";
import { explorerTxUrl } from "@/lib/explorers";
import { cn } from "@/lib/utils";
import { useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { useQueryClient } from "@tanstack/react-query";
import { Connection } from "@solana/web3.js";

import { ArrowDown, CheckCircle2, ExternalLink, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  ...CHAIN_NAMES,
  stellar: "Stellar",
  solana: "Solana",
};


interface ChainBridgeModuleProps {
  smartAddress: string;
  userEmail: string;
  solanaAddress?: string;
  stellarWallet?: { walletId: string; address: string } | null;
}

type Phase = "form" | "submitting" | "monitoring" | "complete";
type BridgeStep = "burn_sig" | "attestation" | "mint_sig" | "complete";

interface Monitor {
  burnTxHash: string;
  sourceChain: SupportedChain | "stellar" | "solana";
  destChain: SupportedChain | "stellar" | "solana";
}

export function ChainBridgeModule({
  smartAddress,
  userEmail,
  solanaAddress,
  stellarWallet,
}: ChainBridgeModuleProps) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");

  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const solConn = useRef(new Connection(SOLANA_RPC, "confirmed"));

  const embeddedSolWallet =
    (solanaAddress
      ? solanaWallets.find((w) => w.address === solanaAddress)
      : null) ?? null;

  const {
    data: portfolio,
    isError: portfolioFailed,
    refetch,
  } = usePortfolio(smartAddress, solanaAddress, stellarWallet?.address);

  /**
   * True until we actually know what the user holds.
   *
   * `isLoading` isn't enough: the query is disabled until the smart account address
   * resolves, so an empty-handed render happens before any fetch begins — which is
   * what made the page claim "no USDC" while balances were still on their way.
   * On error we fall through to the empty state rather than pulsing forever.
   */
  const balancesPending = !portfolio && !portfolioFailed;

  const balanceOf = (chain: SupportedChain | "stellar" | "solana") =>
    parseFloat(
      portfolio?.byChain.find((c) => c.chain === chain)?.balance ?? "0",
    ) || 0;

  const [source, setSource] = useState<
    SupportedChain | "stellar" | "solana" | null
  >(null);
  const [dest, setDest] = useState<
    SupportedChain | "stellar" | "solana" | null
  >(null);
  const [amount, setAmount] = useState("");
  // Fee rate for the summary below. Comes from the server (BRIDGE_FEE_PERCENT) — never a
  // client constant, so what's shown is always what will be charged.
  const bridgeFeePercent = usePlatformFeePercent("bridge");
  const [phase, setPhase] = useState<Phase>("form");
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [bridgeStep, setBridgeStep] = useState<BridgeStep>("burn_sig");
  const mintingRef = useRef(false);
  /** Keeps the retry loop from firing the same error toast every five seconds. */
  const claimErrorNotifiedRef = useRef(false);

  const sourceBalance = source ? balanceOf(source) : 0;
  const amountNum = parseFloat(amount) || 0;
  // What actually leaves the wallet — the balance check must cover amount + fee, not just the
  // amount, or a Max-sized bridge would pass validation and then fail on-chain.
  const bridgeTotal =
    bridgeFeePercent === null ? amountNum : amountNum * (1 + bridgeFeePercent / 100);
  const canBridge =
    !!source &&
    !!dest &&
    source !== dest &&
    amountNum > 0 &&
    // amount + fee must fit, not just the amount.
    bridgeTotal <= sourceBalance &&
    (source === "solana" || dest === "solana" ? !!embeddedSolWallet : true) &&
    (source !== "solana" || dest !== "solana" ? !!embeddedWallet : true);

  // ─── Attestation monitor → mint on destination ──────────────────────────────
  useEffect(() => {
    if (!monitor || phase !== "monitoring") return;
    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MONITOR_MAX_ATTEMPTS) {
        clearInterval(interval);
        // Give up on watching, not on the transfer — the burn and its attestation stay
        // valid forever, so hand it to the Pending Claims panel instead of spinning.
        if (!cancelled) {
          toast.info(
            "This is taking longer than usual. Your USDC is safe — finish the transfer any time from Pending Claims.",
          );
          setPhase("form");
          setMonitor(null);
          queryClient.invalidateQueries({ queryKey: ["pending-bridge-claims"] });
        }
        return;
      }
      try {
        const res = await fetch(
          `/api/bridge/status?txHash=${monitor.burnTxHash}&sourceChain=${monitor.sourceChain}`,
        );
        const data = await res.json();

        // 1. If the mint transaction is already complete (from relayer or DB trigger), finish immediately!
        if (data.status === "complete" && data.mintTxHash) {
          clearInterval(interval);
          setMintTxHash(data.mintTxHash);
          setBridgeStep("complete");
          setPhase("complete");
          queryClient.invalidateQueries({ queryKey: ["portfolio"] });
          queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
          queryClient.invalidateQueries({ queryKey: ["history"] });
          queryClient.invalidateQueries({ queryKey: ["pending-bridge-claims"] });
          toast.success(
            `Bridge complete! USDC is now on ${CHAIN_DISPLAY_NAMES[monitor.destChain]}.`,
          );
          return;
        }

        // 2. If the attestation is ready but we haven't started minting yet, trigger it in the background
        if (data.status === "complete" && !mintingRef.current) {
          mintingRef.current = true;
          
          // Trigger the mint logic in the background without clearing the interval
          (async () => {
            let mintHash: string | undefined = undefined;
            try {
              if (data.attestation && data.messageBytes) {
                setBridgeStep("mint_sig");

                if (monitor.destChain === "solana") {
                  toast.info("Minting USDC on Solana...");
                } else if (monitor.destChain === "stellar") {
                  toast.info("Minting USDC on Stellar...");
                } else {
                  toast.info("Finalising bridge on destination chain...");
                  // Circle's relayer often mints on EVM before we get here — check first
                  // so we don't ask for a signature on a message that's already spent.
                  await new Promise((r) => setTimeout(r, 3000));
                  const recheckData = await fetch(
                    `/api/bridge/status?txHash=${monitor.burnTxHash}&sourceChain=${monitor.sourceChain}`,
                  )
                    .then((r) => r.json())
                    .catch(() => ({}));
                  if (recheckData.mintTxHash) mintHash = recheckData.mintTxHash;
                }

                if (!mintHash) {
                  mintHash = await claimBridgeOnDestination({
                    destChain: monitor.destChain,
                    sourceChain: monitor.sourceChain,
                    burnTxHash: monitor.burnTxHash,
                    messageBytes: data.messageBytes,
                    attestation: data.attestation,
                    embeddedWallet,
                    solanaWallet: embeddedSolWallet,
                    stellarWallet,
                  });
                }
              }

              if (cancelled) return;
              clearInterval(interval);

              await fetch("/api/bridge/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  burnTxHash: monitor.burnTxHash,
                  mintTxHash: mintHash,
                }),
              }).catch(console.error);

              setMintTxHash(mintHash ?? null);
              setBridgeStep("complete");
              setPhase("complete");
              queryClient.invalidateQueries({ queryKey: ["portfolio"] });
              queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
              queryClient.invalidateQueries({ queryKey: ["history"] });
              queryClient.invalidateQueries({ queryKey: ["pending-bridge-claims"] });
              toast.success(
                `Bridge complete! USDC is now on ${CHAIN_DISPLAY_NAMES[monitor.destChain]}.`,
              );
            } catch (err) {
              const classified = classifyAppError(err);
              if (classified.isAlreadyProcessed) {
                clearInterval(interval);
                try {
                  const retryRes = await fetch(
                    `/api/bridge/status?txHash=${monitor.burnTxHash}&sourceChain=${monitor.sourceChain}`,
                  );
                  const retryData = await retryRes.json();
                  const relayedMintHash: string | undefined = retryData.mintTxHash;
                  await fetch("/api/bridge/complete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      burnTxHash: monitor.burnTxHash,
                      mintTxHash: relayedMintHash,
                    }),
                  }).catch(console.error);
                  if (!cancelled) {
                    setMintTxHash(relayedMintHash ?? null);
                  }
                } catch {
                  await fetch("/api/bridge/complete", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      burnTxHash: monitor.burnTxHash,
                      mintTxHash: undefined,
                    }),
                  }).catch(console.error);
                }
                toast.success(
                  "Your USDC has already arrived on the destination chain!",
                );
                setBridgeStep("complete");
                setPhase("complete");
                queryClient.invalidateQueries({ queryKey: ["portfolio"] });
                queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
                queryClient.invalidateQueries({ queryKey: ["history"] });
                queryClient.invalidateQueries({ queryKey: ["pending-bridge-claims"] });
              } else {
                // If it is just a standard timeout or network hang, do a quick status re-check first
                const recheck = await fetch(
                  `/api/bridge/status?txHash=${monitor.burnTxHash}&sourceChain=${monitor.sourceChain}`,
                ).then(r => r.json()).catch(() => ({}));
                
                if (recheck.mintTxHash) {
                  clearInterval(interval);
                  setMintTxHash(recheck.mintTxHash);
                  setBridgeStep("complete");
                  setPhase("complete");
                  queryClient.invalidateQueries({ queryKey: ["portfolio"] });
                  queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
                  queryClient.invalidateQueries({ queryKey: ["history"] });
                  queryClient.invalidateQueries({ queryKey: ["pending-bridge-claims"] });
                  return;
                }

                // The burn is already on-chain and the attestation never expires, so
                // the claim is always safe to retry — the interval keeps trying. Warn
                // the user once instead of once per five-second tick.
                if (!classified.isSilent && !claimErrorNotifiedRef.current) {
                  claimErrorNotifiedRef.current = true;
                  toast.error(classified.message);
                }
                mintingRef.current = false;
                setBridgeStep("attestation");
              }
            }
          })();
        }
      } catch (err) {
        console.error("[ChainBridge] status fetch error:", err);
      }
    }, MONITOR_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    monitor,
    phase,
    embeddedWallet,
    embeddedSolWallet,
    stellarWallet,
    queryClient,
    signTransaction,
  ]);

  const handleBridge = async () => {
    if (!canBridge || !source || !dest) return;
    setPhase("submitting");

    // Resolve the fee BEFORE anything irreversible. A burn can't be undone, so discovering
    // afterwards that this chain has no treasury would mean bridging for free with no way back.
    let platformFee: { usdc: string; treasury: string } | undefined;
    try {
      const quote = await quoteFee("bridge", source, parseFloat(amount));
      if (quote.fee > 0) {
        if (!quote.treasury) {
          throw new Error(
            `Bridging from ${CHAIN_DISPLAY_NAMES[source] ?? source} is unavailable right now. ` +
              `Please try another network.`,
          );
        }
        platformFee = { usdc: quote.fee.toFixed(6), treasury: quote.treasury };
      }
    } catch (err) {
      setPhase("form");
      toast.error(parseAppError(err));
      return;
    }

    setBridgeStep("burn_sig");
    mintingRef.current = false;
    claimErrorNotifiedRef.current = false;
    setMintTxHash(null);
    try {
      // A Stellar account can't hold USDC without a trustline, and the CCTP forwarder
      // mints *and transfers* in one call — so a missing trustline doesn't fail the
      // bridge, it fails the claim, after the burn is already irreversible. Set it up
      // before we burn anything.
      if (dest === "stellar") {
        if (!stellarWallet?.walletId || !stellarWallet?.address) {
          throw new Error(
            "Your Stellar wallet is still being set up. Please try again in a moment.",
          );
        }
        const readyRes = await fetch("/api/stellar/trustline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: stellarWallet.walletId,
            address: stellarWallet.address,
          }),
        });
        const readyData = await readyRes.json().catch(() => ({}));
        if (!readyRes.ok || !readyData.trustlineReady) {
          throw new Error(
            readyData.message ||
              "Your Stellar account isn't ready to receive USDC yet. Please try again in a moment.",
          );
        }
      }

      let burnTxHash: string;
      if (source === "stellar") {
        if (!stellarWallet?.walletId || !stellarWallet?.address) {
          throw new Error(
            "Stellar wallet not found. Check dashboard configuration.",
          );
        }
        const res = await fetch("/api/stellar/bridge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: stellarWallet.walletId,
            senderAddress: stellarWallet.address,
            // Each destination family has its own recipient. Solana was missing here,
            // so Stellar → Solana burns encoded an EVM address as the Solana
            // mintRecipient — a message no Solana claim could ever satisfy.
            //
            // Ethereum L1 disabled — restore alongside it:
            //   : dest === "ethereum" ? embeddedWallet!.address
            recipientAddress: dest === "solana" ? solanaAddress! : smartAddress,
            amount: amount,
            destChain: dest,
            userEmail,
            // Explicit, user-initiated bridge — bill it. The consolidation path in
            // lib/web3/stellar-bridge omits this and is never charged.
            chargeFee: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Stellar bridge failed");
        burnTxHash = data.burnTxHash;
      } else if (source === "solana") {
        if (!embeddedSolWallet) {
          throw new Error("Solana wallet not ready. Please wait a moment.");
        }
        // Ethereum L1 disabled — was: dest === "ethereum" ? embeddedWallet!.address
        const recipient = smartAddress;
        toast.info("Preparing gasless Solana transfer...");
        const { sponsoredTx } = await prepareSolanaBurnTx({
          connection: solConn.current,
          walletAddress: embeddedSolWallet.address,
          amount: amount,
          recipientEvm: recipient,
          destChain: dest as SupportedChain,
        });

        // Privy signs the already-fee-sponsored transaction with the embedded Solana wallet
        const { signedTransaction: signedBytes } = await signTransaction({
          transaction: sponsoredTx.serialize({ requireAllSignatures: false }),
          wallet: embeddedSolWallet,
        });

        // Broadcast the fully-signed transaction ourselves
        const signature = await solConn.current.sendRawTransaction(
          signedBytes,
          {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          },
        );
        const latestBlockhash = await solConn.current.getLatestBlockhash();
        await solConn.current.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          "confirmed",
        );

        burnTxHash = signature;
      } else {
        // Ethereum L1 disabled — was: dest === "ethereum" ? embeddedWallet!.address
        const recipient =
          dest === "stellar"
            ? stellarWallet!.address
            : dest === "solana"
              ? solanaAddress! // recipient on Solana = the user's Solana wallet (CCTP mints to their ATA)
              : smartAddress;
        const { txHashPromise } = await executeSmartBridge(
          embeddedWallet!,
          source as SupportedChain,
          amount,
          recipient,
          dest as SupportedChain | "stellar" | "solana",
          platformFee,
        );
        burnTxHash = await txHashPromise;
      }

      await fetch("/api/bridge/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          sourceChain: source,
          destChain: dest,
          amountUsdc: amountNum,
          burnTxHash,
        }),
      }).catch(console.error);

      setMonitor({ burnTxHash, sourceChain: source, destChain: dest });
      setPhase("monitoring");
      setBridgeStep("attestation");
      refetch();
    } catch (err) {
      const classified = classifyAppError(err);
      if (!classified.isSilent) toast.error(classified.message);
      setPhase("form");
    }
  };

  const resetForm = () => {
    setPhase("form");
    setMonitor(null);
    setMintTxHash(null);
    setAmount("");
    setSource(null);
    setDest(null);
    setBridgeStep("burn_sig");
    mintingRef.current = false;
    claimErrorNotifiedRef.current = false;
    refetch();
  };

  // ─── In-flight / complete states ─────────────────────────────────────────────
  if (
    phase === "monitoring" ||
    phase === "submitting" ||
    phase === "complete"
  ) {
    const isDone = phase === "complete";

    // Step indicator dots
    const step1Done = bridgeStep === "mint_sig" || bridgeStep === "complete";
    const step2Active = bridgeStep === "mint_sig";
    const step2Done = bridgeStep === "complete";

    return (
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6 relative">
        {/* Once it's done the card is just a receipt — let it be closed outright. */}
        {isDone && (
          <button
            onClick={resetForm}
            aria-label="Dismiss"
            className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {/* Icon */}
        <div
          className={cn(
            "w-20 h-20 rounded-3xl flex items-center justify-center border transition-all duration-700",
            isDone
              ? "bg-accent/10 border-accent/40"
              : "bg-white/5 border-white/10",
          )}
        >
          {isDone ? (
            <CheckCircle2 className="w-10 h-10 text-accent" />
          ) : (
            <Loader2 className="w-10 h-10 text-accent animate-spin" />
          )}
        </div>

        {/* Title + subtitle */}
        <div className="space-y-2">
          <h3 className="text-xl font-display font-bold text-white tracking-tight">
            {isDone
              ? "Bridge Complete"
              : step2Active
                ? "2/2 — Finalising on Destination"
                : "1/2 — Burn & Verify"}
          </h3>
          <p className="text-sm text-white/40 max-w-xs mx-auto">
            {isDone && monitor
              ? `Your USDC has arrived on ${CHAIN_DISPLAY_NAMES[monitor.destChain]}.`
              : bridgeStep === "burn_sig"
                ? "Approve the signature popup to initiate the burn."
                : bridgeStep === "attestation"
                  ? "Waiting for Circle to verify the burn (typically 1–3 min)..."
                  : dest === "stellar"
                    ? "Minting USDC on Stellar..."
                    : dest === "solana"
                      ? "Approve the popup to receive USDC on Solana."
                      : "Circle is minting your USDC on the destination chain..."}
          </p>
        </div>

        {/* Minimal step dots */}
        <div className="flex items-center gap-3">
          {/* Step 1 */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all",
                step1Done
                  ? "bg-accent border-accent text-[#07070a]"
                  : "bg-accent/10 border-accent text-accent animate-pulse",
              )}
            >
              {step1Done ? "✓" : "1"}
            </div>
            <span
              className={cn(
                "text-[10px] font-bold uppercase tracking-widest",
                step1Done ? "text-white/40" : "text-white",
              )}
            >
              Burn
            </span>
          </div>

          <div className="w-8 h-px bg-white/15" />

          {/* Step 2 */}
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all",
                step2Done
                  ? "bg-accent border-accent text-[#07070a]"
                  : step2Active
                    ? "bg-accent/10 border-accent text-accent animate-pulse"
                    : "border-white/10 text-white/20",
              )}
            >
              {step2Done ? "✓" : "2"}
            </div>
            <span
              className={cn(
                "text-[10px] font-bold uppercase tracking-widest",
                step2Done
                  ? "text-white/40"
                  : step2Active
                    ? "text-white"
                    : "text-white/20",
              )}
            >
              Mint
            </span>
          </div>
        </div>

        {/* Tx links + actions */}
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div className="flex gap-3 w-full justify-center">
            {monitor && (
              <a
                href={
                  explorerTxUrl(monitor.sourceChain, monitor.burnTxHash) || "#"
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Burn Tx
              </a>
            )}
            {isDone && mintTxHash && monitor && (
              <a
                href={explorerTxUrl(monitor.destChain, mintTxHash) || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 btn-secondary h-11 rounded-xl flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Mint Tx
              </a>
            )}
          </div>
          {isDone && (
            <button
              onClick={resetForm}
              className="btn-accent h-11 w-full rounded-xl text-[10px] font-bold uppercase tracking-widest"
            >
              Bridge Again
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────
  const allSources = [
    // Ethereum L1 is filtered out on both sides — see BRIDGE_DISABLED_CHAINS.
    ...EVM_CHAINS.filter(isBridgeable),
    ...(stellarWallet?.address ? ["stellar" as const] : []),
    // ...(solanaAddress ? ["solana" as const] : []),
  ];
  // Sources and destinations come from the same list on purpose. Excluding a chain here
  // while still offering it below would let funds bridge in with no way to bridge out.
  const fundedSources = allSources.filter((c) => balanceOf(c) > 0);
  const destinationChains = allSources.filter((c) => c !== source);

  return (
    <div className="card-glass p-6 sm:p-8 space-y-8">
      {/* From */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
          From
        </p>
        {balancesPending ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 px-3 py-3 rounded-xl border border-white/8 bg-white/3"
              >
                <Skeleton className="w-[22px] h-[22px] rounded-full bg-white/8 shrink-0" />
                <div className="min-w-0 space-y-1.5 flex-1">
                  <Skeleton className="h-2.5 w-16 bg-white/8" />
                  <Skeleton className="h-2 w-10 bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : fundedSources.length === 0 ? (
          <div className="rounded-2xl p-5 text-center text-sm text-white/40 bg-white/3 border border-white/6">
            No USDC found on any network yet. Deposit first.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fundedSources.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setSource(c);
                  if (dest === c) setDest(null);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-3 rounded-xl border transition-all text-left",
                  source === c
                    ? "border-accent/40 bg-accent/10"
                    : "border-white/8 bg-white/3 hover:bg-white/5",
                )}
              >
                <ChainLogo chain={c} size={22} />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {CHAIN_DISPLAY_NAMES[c]}
                  </p>
                  <p className="text-[10px] text-white/40 font-mono">
                    ${balanceOf(c).toFixed(2)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <ArrowDown className="w-4 h-4 text-accent" />
        </div>
      </div>

      {/* To */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
          To
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {destinationChains.map((c) => (
            <button
              key={c}
              onClick={() => setDest(c)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-3 rounded-xl border transition-all text-left",
                dest === c
                  ? "border-accent/40 bg-accent/10"
                  : "border-white/8 bg-white/3 hover:bg-white/5",
              )}
            >
              <ChainLogo chain={c} size={22} />
              <p className="text-xs font-bold text-white truncate">
                {CHAIN_DISPLAY_NAMES[c]}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
            Amount
          </p>
          {source && (
            <button
              disabled={bridgeFeePercent === null}
              onClick={() => {
                // Leave room for the fee: the wallet must cover amount + fee, so Max is the
                // largest amount whose total still fits. Disabled until the rate is known —
                // filling in the full balance and correcting later is how Max produced an
                // amount that immediately read "exceeds your balance".
                if (bridgeFeePercent === null) return;
                const max = sourceBalance / (1 + bridgeFeePercent / 100);
                setAmount((Math.floor(max * 1e6) / 1e6).toString());
              }}
              className="text-[10px] font-bold uppercase tracking-widest text-accent/70 hover:text-accent"
            >
              Max ${sourceBalance.toFixed(2)}
            </button>
          )}
        </div>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-white/3 border border-white/8 rounded-2xl px-4 py-4 text-2xl font-bold text-white outline-none focus:border-accent/40 transition-colors"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-white/20 uppercase">
            USDC
          </span>
        </div>
        {/* Amount + fee + total, matching the withdrawal summary. */}
        {amountNum > 0 && bridgeFeePercent !== null && (() => {
          const s = formatFeeSummary(
            amountNum,
            (amountNum * bridgeFeePercent) / 100,
            amountNum * (1 + bridgeFeePercent / 100),
          );
          return (
          <div className="rounded-2xl bg-white/3 border border-white/8 px-4 py-3 space-y-2">
            <div className="flex justify-between text-[11px] text-white/40">
              <span>Bridging</span>
              <span className="tabular-nums">{s.amount} USDC</span>
            </div>
            <div className="flex justify-between text-[11px] text-white/40">
              <span>Platform Fee ({bridgeFeePercent}%)</span>
              <span className="tabular-nums">
                {s.fee} USDC
              </span>
            </div>
            <div className="flex justify-between text-xs font-bold text-white pt-2 border-t border-white/8">
              <span>Total Deducted</span>
              <span className="tabular-nums">
                {s.total} USDC
              </span>
            </div>
          </div>
          );
        })()}

        {bridgeTotal > sourceBalance && source && (
          <p className="text-[11px] text-red-400/80 px-1">
            Exceeds your {CHAIN_DISPLAY_NAMES[source]} balance
            {bridgeFeePercent ? " once the fee is included" : ""}.
          </p>
        )}
      </div>

      <button
        onClick={handleBridge}
        disabled={!canBridge}
        className={cn(
          "w-full h-14 rounded-2xl font-bold text-sm uppercase tracking-widest transition-all",
          canBridge
            ? "btn-accent"
            : "bg-white/5 border border-white/8 text-white/25 cursor-not-allowed",
        )}
      >
        {source && dest
          ? `Bridge to ${CHAIN_DISPLAY_NAMES[dest]}`
          : "Select networks"}
      </button>

      {/* <p className="text-[11px] text-white/30 leading-relaxed text-center">
        Funds move between your own wallets via Circle CCTP. Gasless on both sides; a
        small Circle network fee is deducted from the bridged amount.
      </p> */}
    </div>
  );
}
