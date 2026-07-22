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
import { usePortfolio } from "@/hooks/usePortfolio";
import {
  CHAIN_EXPLORERS,
  CHAIN_NAMES,
  type SupportedChain,
} from "@/lib/circle/gateway";
import { EVM_CHAINS } from "@/lib/web3/routing";
import {
  executeSmartBridge,
  executeReceiveMessage,
} from "@/lib/web3/bridge-actions";
import { prepareSolanaBurnTx } from "@/lib/web3/solana-bridge";
import { buildReceiveMessageOnSolanaTx } from "@/lib/circle/solana-gateway";
import { PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

import { recordBridgeTransaction } from "@/lib/supabase/transactions";
import { cn } from "@/lib/utils";
import { useWallets } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { useQueryClient } from "@tanstack/react-query";
import { Connection } from "@solana/web3.js";

import { ArrowDown, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
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

const CHAIN_EXPLORER_TX: Record<string, (hash: string) => string> = {
  ...Object.fromEntries(
    Object.entries(CHAIN_EXPLORERS).map(([chain, base]) => [
      chain,
      (hash: string) => `${base}/${hash}`,
    ]),
  ),
  stellar: (hash: string) =>
    `https://stellar.expert/explorer/public/tx/${hash}`,
  solana: (hash: string) => `https://solscan.io/tx/${hash}`,
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

  const { data: portfolio, refetch } = usePortfolio(
    smartAddress,
    solanaAddress,
    stellarWallet?.address,
  );

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
  const [phase, setPhase] = useState<Phase>("form");
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [mintTxHash, setMintTxHash] = useState<string | null>(null);
  const [bridgeStep, setBridgeStep] = useState<BridgeStep>("burn_sig");
  const mintingRef = useRef(false);

  const sourceBalance = source ? balanceOf(source) : 0;
  const amountNum = parseFloat(amount) || 0;
  const canBridge =
    !!source &&
    !!dest &&
    source !== dest &&
    amountNum > 0 &&
    amountNum <= sourceBalance &&
    (source === "solana" || dest === "solana" ? !!embeddedSolWallet : true) &&
    (source !== "solana" || dest !== "solana" ? !!embeddedWallet : true);

  // ─── Attestation monitor → mint on destination ──────────────────────────────
  useEffect(() => {
    if (!monitor || phase !== "monitoring") return;
    let cancelled = false;
    let attempts = 0;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 180) {
        clearInterval(interval);
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
                if (monitor.destChain === "solana") {
                  if (!embeddedSolWallet)
                    throw new Error("Solana wallet not found for minting");
                  setBridgeStep("mint_sig");
                  toast.info(
                    "Attestation ready! Approve the popup to receive USDC on Solana.",
                  );
                  const walletPubkey = new PublicKey(embeddedSolWallet.address);
                  const { transaction } = await buildReceiveMessageOnSolanaTx(
                    solConn.current,
                    walletPubkey,
                    data.messageBytes,
                    data.attestation,
                  );
                  const txBase64 = transaction
                    .serialize({
                      requireAllSignatures: false,
                      verifySignatures: false,
                    })
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
                  const { signedTransaction: signedBytes } = await signTransaction({
                    transaction: sponsoredTx.serialize({
                      requireAllSignatures: false,
                    }),
                    wallet: embeddedSolWallet,
                  });
                  const signature = await solConn.current.sendRawTransaction(
                    signedBytes,
                    {
                      skipPreflight: false,
                      preflightCommitment: "confirmed",
                    },
                  );
                  const lb = await solConn.current.getLatestBlockhash();
                  await solConn.current.confirmTransaction(
                    {
                      signature,
                      blockhash: lb.blockhash,
                      lastValidBlockHeight: lb.lastValidBlockHeight,
                    },
                    "confirmed",
                  );
                  mintHash = signature;
                } else if (monitor.destChain === "stellar") {
                  setBridgeStep("mint_sig");
                  toast.info("Minting USDC on Stellar...");
                  const claimRes = await fetch("/api/stellar/claim", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      txHash: monitor.burnTxHash,
                      sourceChain: monitor.sourceChain,
                    }),
                  });
                  if (!claimRes.ok) {
                    const claimErr = await claimRes.json();
                    throw new Error(claimErr.error || "Failed to claim on Stellar");
                  }
                  mintHash = (await claimRes.json()).txHash;
                } else if (embeddedWallet) {
                  setBridgeStep("mint_sig");
                  toast.info("Finalising bridge on destination chain...");
                  await new Promise((r) => setTimeout(r, 3000));
                  const recheckRes = await fetch(
                    `/api/bridge/status?txHash=${monitor.burnTxHash}&sourceChain=${monitor.sourceChain}`,
                  );
                  const recheckData = await recheckRes.json();
                  if (recheckData.mintTxHash) {
                    mintHash = recheckData.mintTxHash;
                  } else {
                    console.log(
                      "[ChainBridge] Submitting receiveMessage for",
                      monitor.destChain,
                    );
                    mintHash = await executeReceiveMessage(
                      embeddedWallet,
                      data.messageBytes,
                      data.attestation,
                      monitor.destChain as SupportedChain,
                    );
                    console.log("[ChainBridge] receiveMessage tx:", mintHash);
                  }
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
              toast.success(
                `Bridge complete! USDC is now on ${CHAIN_DISPLAY_NAMES[monitor.destChain]}.`,
              );
            } catch (err) {
              console.error("[ChainBridge] monitor error:", err);
              const errMsg = err instanceof Error ? err.message : String(err);
              const lowerErr = errMsg.toLowerCase();
              if (
                lowerErr.includes("nonce already used") ||
                lowerErr.includes("message already received") ||
                lowerErr.includes("message already processed")
              ) {
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
                  return;
                }

                if (!/cancelled|rejected|denied|timeout/i.test(errMsg)) {
                  toast.error(`Bridge claim failed: ${errMsg}`);
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
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [monitor, phase, embeddedWallet, embeddedSolWallet, queryClient]);

  const handleBridge = async () => {
    if (!canBridge || !source || !dest) return;
    setPhase("submitting");

    setBridgeStep("burn_sig");
    mintingRef.current = false;
    setMintTxHash(null);
    try {
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
            recipientAddress:
              dest === "ethereum" ? embeddedWallet!.address : smartAddress,
            amount: amount,
            destChain: dest,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Stellar bridge failed");
        burnTxHash = data.burnTxHash;
      } else if (source === "solana") {
        if (!embeddedSolWallet) {
          throw new Error("Solana wallet not ready. Please wait a moment.");
        }
        const recipient =
          dest === "ethereum" ? embeddedWallet!.address : smartAddress;
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
        const recipient =
          dest === "stellar"
            ? stellarWallet!.address
            : dest === "solana"
              ? solanaAddress! // recipient on Solana = the user's Solana wallet (CCTP mints to their ATA)
              : dest === "ethereum"
                ? embeddedWallet!.address
                : smartAddress;
        const { txHashPromise } = await executeSmartBridge(
          embeddedWallet!,
          source as SupportedChain,
          amount,
          recipient,
          dest as SupportedChain | "stellar" | "solana",
        );
        burnTxHash = await txHashPromise;
      }

      await recordBridgeTransaction({
        userEmail,
        sourceChain: source as any,
        destChain: dest as any,
        amountUsdc: amountNum,
        burnTxHash,
      }).catch(console.error);

      setMonitor({ burnTxHash, sourceChain: source, destChain: dest });
      setPhase("monitoring");
      setBridgeStep("attestation");
      refetch();
    } catch (err) {
      console.error("[ChainBridge] bridge failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (!/cancelled|rejected|denied/i.test(msg)) {
        toast.error(
          msg.length <= 120 ? msg : "Bridge failed. Please try again.",
        );
      }
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
      <div className="card-glass p-12 flex flex-col items-center justify-center text-center space-y-6">
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
                  CHAIN_EXPLORER_TX[monitor.sourceChain]?.(
                    monitor.burnTxHash,
                  ) || "#"
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
                href={CHAIN_EXPLORER_TX[monitor.destChain]?.(mintTxHash) || "#"}
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

        {!isDone && bridgeStep !== "burn_sig" && phase !== "submitting" && (
          <p className="text-[10px] text-white/15">
            You can safely close this — the bridge completes automatically.
          </p>
        )}
      </div>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────
  const allSources = [
    ...EVM_CHAINS,
    ...(stellarWallet?.address ? ["stellar" as const] : []),
    ...(solanaAddress ? ["solana" as const] : []),
  ];
  const fundedSources = allSources.filter((c) => balanceOf(c) > 0 && c !== "polygon");
  const destinationChains =
    source === "solana"
      ? allSources.filter((c) => c !== source && c !== "stellar")
      : source === "stellar"
        ? allSources.filter((c) => c !== source && c !== "solana")
        : allSources.filter((c) => {
            if (c === source) return false;
            // Allow Solana as dest only if the user has a Solana wallet
            if (c === "solana" && !solanaAddress) return false;
            return true;
          });

  return (
    <div className="card-glass p-6 sm:p-8 space-y-8">
      {/* From */}
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">
          From
        </p>
        {fundedSources.length === 0 ? (
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
                  if (c === "solana") {
                    // Solana → EVM: default to Base
                    setDest((prev) =>
                      prev && prev !== "solana" && prev !== "stellar"
                        ? prev
                        : "base",
                    );
                  } else if (c === "stellar") {
                    // Stellar can't go to Solana
                    if (dest === c || dest === "solana") setDest(null);
                  } else {
                    // EVM source: only reset dest if it equals the new source
                    if (dest === c) setDest(null);
                  }
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
              onClick={() => setAmount(sourceBalance.toString())}
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
        {amountNum > sourceBalance && source && (
          <p className="text-[11px] text-red-400/80 px-1">
            Exceeds your {CHAIN_DISPLAY_NAMES[source]} balance.
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
