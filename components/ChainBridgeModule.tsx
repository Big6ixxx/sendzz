"use client";

/**
 * ChainBridgeModule — move USDC between the user's own networks.
 *
 * The bridge UI. This lets
 * the user pick BOTH the source and destination chain and bridge between them via
 * Circle CCTP V2. The mint recipient is the user's own smart account (for EVM) or
 * Stellar address. Gasless on both legs (burn + mint sponsored by circle/relayer).
 */

import { ChainLogo } from "@/components/deposit-withdraw/ChainLogo";
import { recordBurn } from "@/lib/web3/record-burn";
import { formatFeeSummary } from "@/lib/format-usdc";
import { usePlatformFeePercent } from "@/lib/hooks/usePlatformFeePercent";
import { quoteFee } from "@/lib/actions/fees";
import { parseAppError } from "@/lib/errors/appErrors";
import { CLAIM_MAX_ATTEMPTS, MONITOR_MAX_ATTEMPTS, MONITOR_POLL_MS } from "@/lib/web3/bridge-timing";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CHAIN_NAMES, isBridgeable, type SupportedChain } from "@/lib/circle/gateway";
import { EVM_CHAINS, isUnsupportedBridgePair } from "@/lib/web3/routing";
import { NETWORK } from "@/lib/network";
import { executeSmartBridge } from "@/lib/web3/bridge-actions";
import { prepareSolanaBurnTx } from "@/lib/web3/solana-bridge";
import { claimBridgeOnDestination } from "@/lib/web3/bridge-claim";
import { refreshExpiredBridgeClaim } from "@/lib/supabase/transactions";
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

import { ArrowUpDown, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2, X } from "lucide-react";
import { AsideRows, FlowButton, Notice } from "@/components/flow/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useEffect, useRef, useState } from "react";
import { usePinAuthorization } from "@/components/security/PinAuthorizationProvider";
import { noteTransactionAuthorization } from "@/lib/actions/transactionAuth";
import { describeBridge } from "@/lib/signing/describe";
import { toast } from "sonner";
import { solanaRpcUrl } from "@/lib/solana/rpc";
import { sendAndConfirmSigned } from "@/lib/solana/confirm";
import { isStellarReady, type StellarWalletInfo } from "@/hooks/useStellarWallet";
import { Skeleton } from "@/components/ui/skeleton";

const SOLANA_RPC = solanaRpcUrl();

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  ...CHAIN_NAMES,
  stellar: "Stellar",
  solana: "Solana",
};


interface ChainBridgeModuleProps {
  smartAddress: string;
  userEmail: string;
  solanaAddress?: string;
  stellarWallet?: StellarWalletInfo | null;
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
  const { authorize } = usePinAuthorization();
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
  const claimAttemptsRef = useRef(0);

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
    !isUnsupportedBridgePair(source, dest) &&
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
            "This is taking longer than usual. Your USDC is safe, and you can finish the transfer any time from Pending Claims.",
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
                  toast.info("Delivering your money on Solana…");
                } else if (monitor.destChain === "stellar") {
                  toast.info("Delivering your money on Stellar…");
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
                    // The claim needs only the address; the server signs.
                    solanaWallet: solanaAddress ? { address: solanaAddress } : null,
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

                // An expired signature is the one failure retrying cannot fix: it reverts on
                // every attempt until Circle signs the message again. Ask for that once, then
                // let the loop carry on — the reissued attestation arrives within a minute and
                // the next tick claims it normally.
                if (classified.category === "attestation_expired") {
                  await refreshExpiredBridgeClaim(monitor.burnTxHash);
                }

                // Retried, but not forever.
                //
                // A claim is worth another go — the burn is on-chain and the money is owed
                // regardless, and most failures here are a slow RPC or a signature that needs
                // reissuing. But some can never succeed however often they are tried, and this
                // loop used to try them every five seconds for as long as the user watched,
                // flipping the step between "mint" and "attestation" each time with no idea why.
                //
                // So it stops after CLAIM_MAX_ATTEMPTS and hands the claim to Pending Claims,
                // which is where an unfinished transfer belongs. Nothing is lost by stopping: the
                // burn and its record outlive the page, and the panel can claim it any time.
                claimAttemptsRef.current += 1;
                const givingUp = claimAttemptsRef.current >= CLAIM_MAX_ATTEMPTS;

                if (!classified.isSilent && (!claimErrorNotifiedRef.current || givingUp)) {
                  claimErrorNotifiedRef.current = true;
                  toast.error(classified.message);
                }

                if (givingUp) {
                  clearInterval(interval);
                  if (!cancelled) {
                    toast.info(
                      "Your USDC is safe. You can finish this transfer any time from Pending Claims.",
                    );
                    setPhase("form");
                    setMonitor(null);
                    queryClient.invalidateQueries({ queryKey: ["pending-bridge-claims"] });
                  }
                  return;
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
    solanaAddress,
    stellarWallet,
    queryClient,
  ]);

  const handleBridge = async () => {
    if (!canBridge || !source || !dest) return;

    // The PIN comes before the fee quote and well before the burn. A bridge is irreversible
    // the instant the burn lands, and the two-step burn-then-claim shape means a user who
    // walks away mid-flow has already committed — so the approval belongs at the very front,
    // where backing out still costs nothing.
    const authorization = await authorize({
      purpose: "bridge",
      payload: { destination: dest, amount, chain: source },
      amount: `${parseFloat(amount || "0").toFixed(2)} USDC`,
      destination: `${CHAIN_DISPLAY_NAMES[source] ?? source} → ${CHAIN_DISPLAY_NAMES[dest] ?? dest}`,
      warning: "Cannot be undone once it starts.",
      // No detail rows. The amount and the route are the whole of it and they are already the
      // headline; the three rows this replaces restated the heading word for word.
      plan: describeBridge({ amount, sourceChain: source, destChain: dest }),
      confirmLabel: "Start bridge",
    });
    if (!authorization) return;

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

    // Solana and EVM burns are signed in the page, so this records the PIN rather than
    // gating on it. The Stellar branch below hands the token to the server instead.
    if (source !== "stellar") {
      void noteTransactionAuthorization({
        token: authorization,
        purpose: "bridge",
        payload: { destination: dest, amount, chain: source },
      }).catch(() => undefined);
    }

    mintingRef.current = false;
    claimErrorNotifiedRef.current = false;
    claimAttemptsRef.current = 0;
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
      // Set once the Solana burn is recorded at broadcast, so it is not written twice.
      let burnRecorded = false;
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
            // The one bridge the user came to do, so the one that is billed. Bridging inside a
            // transfer, send or withdrawal (lib/web3/stellar-bridge) never is.
            chargeFee: true,
            // The server broadcasts this one, so it enforces the PIN rather than noting it.
            authorization,
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
        toast.info("Preparing your transfer. We cover the network fee.");
        const { sponsoredTx } = await prepareSolanaBurnTx({
          connection: solConn.current,
          walletAddress: embeddedSolWallet.address,
          amount: amount,
          recipientEvm: recipient,
          destChain: dest as SupportedChain,
          // Rides in the same transaction as the burn, as on the EVM rails.
          platformFee,
        });

        // Privy signs the already-fee-sponsored transaction with the embedded Solana wallet
        const { signedTransaction: signedBytes } = await signTransaction({
          transaction: sponsoredTx.serialize({ requireAllSignatures: false }),
          wallet: embeddedSolWallet,
          chain: NETWORK.solana.privyCluster,
        });

        // Broadcast it ourselves, and confirm against its own blockhash. Recorded on broadcast:
        // a confirmation that throws does not mean the burn failed to land.
        const signature = await sendAndConfirmSigned(
          solConn.current,
          signedBytes,
          sponsoredTx.lastValidBlockHeight,
          async (sig) => {
            await recordBurn({
              userEmail,
              sourceChain: source,
              destChain: dest,
              amountUsdc: amountNum,
              burnTxHash: sig,
            });
            burnRecorded = true;
          },
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

      if (!burnRecorded) {
        await recordBurn({
          userEmail,
          sourceChain: source,
          destChain: dest,
          amountUsdc: amountNum,
          burnTxHash,
        });
      }

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
    claimAttemptsRef.current = 0;
    refetch();
  };

  // ─── In-flight / complete states ─────────────────────────────────────────────
  if (
    phase === "monitoring" ||
    phase === "submitting" ||
    phase === "complete"
  ) {
    const isDone = phase === "complete";
    const step1Done = bridgeStep === "mint_sig" || bridgeStep === "complete";
    const step2Active = bridgeStep === "mint_sig";
    const step2Done = bridgeStep === "complete";
    const from = monitor ? CHAIN_DISPLAY_NAMES[monitor.sourceChain] : source ? CHAIN_DISPLAY_NAMES[source] ?? source : "this network";
    const to = monitor ? CHAIN_DISPLAY_NAMES[monitor.destChain] : dest ? CHAIN_DISPLAY_NAMES[dest] ?? dest : "the other network";
    const steps = [
      { label: `Leaving ${from}`, done: step1Done, active: !step1Done },
      { label: `Arriving on ${to}`, done: step2Done, active: step2Active },
    ];
    const linkPill =
      "inline-flex h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--lp-surface)] px-5 text-[15px] font-semibold shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.12)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.4)]";

    return (
      <section className="lp-card relative mx-auto max-w-[620px] rounded-[32px] p-6 text-center sm:p-10">
        {/* Once it's done the card is just a receipt — let it be closed outright. */}
        {isDone && (
          <button
            type="button"
            onClick={resetForm}
            aria-label="Dismiss"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)]"
          >
            <X className="size-4" />
          </button>
        )}

        <span
          className={cn(
            "mx-auto grid size-20 place-items-center rounded-full transition-colors duration-500",
            isDone ? "lp-on-green text-[var(--lp-ink)]" : "bg-[var(--lp-cream)] text-[var(--lp-ink)]",
          )}
        >
          {isDone ? <CheckCircle2 className="size-10" /> : <Loader2 className="size-9 animate-spin" />}
        </span>

        <h2 className="lp-display mt-6 text-[clamp(32px,7vw,44px)] leading-[0.95] tracking-[-0.045em]">
          {isDone ? "All" : "Moving"} <span className="lp-serif tracking-[-0.02em]">{isDone ? "done." : "your money."}</span>
        </h2>
        <p className="mx-auto mt-3 max-w-[380px] text-[16px] leading-[1.5] text-[var(--lp-body)]">
          {/* Two of these used to tell the user to approve a pop-up. There is no pop-up any
              more — Privy's UIs are off and we take the confirmation ourselves before any of
              this starts — so the instruction was not merely jargon, it was an instruction to
              do something impossible while they waited. */}
          {isDone && monitor
            ? `Your money has arrived on ${CHAIN_DISPLAY_NAMES[monitor.destChain]}.`
            : bridgeStep === "burn_sig"
              ? `Moving your money off ${from}…`
              : bridgeStep === "attestation"
                ? "Both networks are confirming the move. Usually 1–3 minutes. You can leave this page; it carries on."
                : `Delivering your money on ${to}…`}
        </p>

        {/* Two steps, named for what the person cares about rather than what the protocol does. */}
        <ol className="mx-auto mt-7 grid max-w-[420px] gap-2 text-left">
          {steps.map((st, i) => (
            <li
              key={st.label}
              className={cn(
                "flex items-center gap-3 rounded-[18px] px-4 py-3",
                st.done ? "bg-[var(--lp-good-soft)]" : st.active ? "bg-[var(--lp-cream)]" : "bg-transparent shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)]",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold",
                  st.done ? "bg-[var(--lp-good)] text-[var(--lp-cream)]" : st.active ? "bg-[var(--lp-ink)] text-[var(--lp-cream)]" : "bg-[var(--lp-cream)] text-[var(--lp-muted)]",
                )}
              >
                {st.done ? <Check className="size-4" /> : i + 1}
              </span>
              <span className={cn("flex-1 text-[15px] font-semibold", !st.done && !st.active && "text-[var(--lp-muted)]")}>{st.label}</span>
              {st.active && !st.done && <Loader2 className="size-4 animate-spin text-[var(--lp-muted)]" />}
            </li>
          ))}
        </ol>

        <div className="mx-auto mt-7 flex max-w-[420px] flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            {monitor && (
              <a href={explorerTxUrl(monitor.sourceChain, monitor.burnTxHash) || "#"} target="_blank" rel="noopener noreferrer" className={linkPill}>
                <ExternalLink className="size-4" /> Where it left
              </a>
            )}
            {isDone && mintTxHash && monitor && (
              <a href={explorerTxUrl(monitor.destChain, mintTxHash) || "#"} target="_blank" rel="noopener noreferrer" className={linkPill}>
                <ExternalLink className="size-4" /> Where it arrived
              </a>
            )}
          </div>
          {isDone && (
            <FlowButton tone="accent" onClick={resetForm}>
              Move more money
            </FlowButton>
          )}
        </div>
      </section>
    );
  }

  // ─── Form ────────────────────────────────────────────────────────────────────
  const allSources = [
    // Ethereum L1 is filtered out on both sides — see BRIDGE_DISABLED_CHAINS.
    ...EVM_CHAINS.filter(isBridgeable),
    // Stellar is opt-in: listed only once activated (account + USDC trustline in place).
    ...(isStellarReady(stellarWallet) ? ["stellar" as const] : []),
    ...(solanaAddress ? ["solana" as const] : []),
  ];
  // Sources and destinations come from the same list on purpose. Excluding a chain here
  // while still offering it below would let funds bridge in with no way to bridge out.
  const fundedSources = allSources.filter((c) => balanceOf(c) > 0);
  const destinationChains = allSources.filter(
    (c) => c !== source && !(source && isUnsupportedBridgePair(source, c)),
  );

  const fee =
    amountNum > 0 && bridgeFeePercent !== null
      ? formatFeeSummary(amountNum, (amountNum * bridgeFeePercent) / 100, amountNum * (1 + bridgeFeePercent / 100))
      : null;
  const overBalance = !!source && bridgeTotal > sourceBalance;
  // Swapping only makes sense when the destination holds something to move back.
  const canSwap = !!source && !!dest && balanceOf(dest) > 0 && !isUnsupportedBridgePair(dest, source);
  const swap = () => {
    if (!canSwap) return;
    setSource(dest);
    setDest(source);
  };
  const useMax = () => {
    // Leave room for the fee: the wallet must cover amount + fee, so Max is the largest amount
    // whose total still fits. Disabled until the rate is known — filling in the full balance
    // and correcting later is how Max produced an amount that immediately read "exceeds your
    // balance".
    if (bridgeFeePercent === null) return;
    const max = sourceBalance / (1 + bridgeFeePercent / 100);
    setAmount((Math.floor(max * 1e6) / 1e6).toString());
  };
  const pickSource = (c: NonNullable<typeof source>) => {
    setSource(c);
    if (dest === c || (dest && isUnsupportedBridgePair(c, dest))) setDest(null);
  };

  const totalHeld = fundedSources.reduce((sum, c) => sum + balanceOf(c), 0);
  const largest = Math.max(0, ...fundedSources.map(balanceOf));
  const byBalance = [...fundedSources].sort((a, b) => balanceOf(b) - balanceOf(a));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-6">
      {/* ── The converter ─────────────────────────────────────────────────── */}
      <section className="lp-on-forest rounded-[36px] p-3 text-[var(--lp-cream)] sm:p-4">
        <div className="relative space-y-2">
          <Slot label="From">
            <div className="flex items-center justify-between gap-3">
              <NetworkPicker
                value={source}
                placeholder={fundedSources.length ? "Choose network" : "Nothing to move"}
                options={fundedSources}
                balanceOf={balanceOf}
                onPick={pickSource}
                disabled={!fundedSources.length}
              />
              {source && (
                <button
                  type="button"
                  onClick={useMax}
                  disabled={bridgeFeePercent === null}
                  className="rounded-full bg-[var(--lp-surface)] px-3 py-1.5 text-[13px] font-semibold shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)] disabled:text-[var(--lp-muted)]"
                >
                  Use max
                </button>
              )}
            </div>
            <label className="mt-5 flex items-baseline gap-1.5">
              <span className="sr-only">Amount to move</span>
              <span className="lp-display text-[clamp(28px,6vw,40px)] leading-none tracking-[-0.03em] text-[var(--lp-muted)]">$</span>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="lp-display w-full min-w-0 flex-1 bg-transparent text-[clamp(44px,10vw,64px)] leading-none tracking-[-0.045em] tabular-nums outline-none placeholder:text-[var(--lp-line)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </label>
            <p className={cn("mt-3 text-[14px]", overBalance ? "font-semibold text-[var(--lp-danger)]" : "text-[var(--lp-muted)]")}>
              {!source
                ? "Pick where the money comes from."
                : overBalance
                  ? `More than the $${sourceBalance.toFixed(2)} on ${CHAIN_DISPLAY_NAMES[source]}${bridgeFeePercent ? ", fee included" : ""}.`
                  : `$${sourceBalance.toFixed(2)} on ${CHAIN_DISPLAY_NAMES[source]}`}
            </p>
          </Slot>

          {/* The swap sits on the seam between the two slots, the converter's own gesture. */}
          <button
            type="button"
            onClick={swap}
            disabled={!canSwap}
            aria-label="Swap networks"
            className="lp-on-green absolute left-1/2 top-1/2 z-10 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-[var(--lp-forest)] text-[var(--lp-ink)] transition-transform duration-200 hover:rotate-180 disabled:bg-[var(--lp-line)] disabled:text-[var(--lp-muted)] disabled:hover:rotate-0"
          >
            <ArrowUpDown className="size-5" />
          </button>

          <Slot label="To">
            <NetworkPicker
              value={dest}
              placeholder="Choose network"
              options={destinationChains}
              onPick={(c) => setDest(c)}
              disabled={!source}
            />
            <p className="mt-5 flex items-baseline gap-1.5" aria-live="polite">
              <span className="lp-display text-[clamp(28px,6vw,40px)] leading-none tracking-[-0.03em] text-[var(--lp-muted)]">$</span>
              <span
                className={cn(
                  "lp-display min-w-0 truncate text-[clamp(44px,10vw,64px)] leading-none tracking-[-0.045em] tabular-nums",
                  !(amountNum > 0) && "text-[var(--lp-line)]",
                )}
              >
                {fee ? fee.amount : amountNum > 0 ? amountNum.toFixed(2) : "0.00"}
              </span>
            </p>
            <p className="mt-3 text-[14px] text-[var(--lp-muted)]">
              {dest ? `Arrives on ${CHAIN_DISPLAY_NAMES[dest]}, usually in a few minutes.` : "Pick where it should arrive."}
            </p>
          </Slot>
        </div>

        <div className="px-3 pb-3 pt-4 sm:px-4">
          {fee && (
            <AsideRows
              rows={[
                { label: `Fee (${bridgeFeePercent}%)`, value: `${fee.fee} USDC` },
                { label: "Taken from your balance", value: `${fee.total} USDC` },
                { label: "Network fees", value: "On us", tone: "good" as const },
              ]}
            />
          )}
          <div className="mt-4">
            <FlowButton tone="accent" onClick={handleBridge} disabled={!canBridge}>
              {source && dest ? `Move to ${CHAIN_DISPLAY_NAMES[dest]}` : "Choose both networks"}
            </FlowButton>
          </div>
        </div>
      </section>

      {/* ── Where the money is ───────────────────────────────────────────── */}
      <section className="lp-card rounded-[28px] p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="lp-display text-[22px] tracking-[-0.02em]">
            Where your <span className="lp-serif">money is</span>
          </h2>
          {!balancesPending && <span className="text-[15px] font-semibold tabular-nums">${totalHeld.toFixed(2)}</span>}
        </div>
        <p className="mt-1 text-[14px] text-[var(--lp-muted)]">Tap a network to move money from it.</p>

        {balancesPending ? (
          <ul className="mt-4 space-y-3" aria-label="Loading balances">
            {[0, 1, 2].map((i) => (
              <li key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-2.5" />
              </li>
            ))}
          </ul>
        ) : byBalance.length === 0 ? (
          <div className="mt-4">
            <Notice title="Nothing to move yet">Add money first, then come back to move it between networks.</Notice>
          </div>
        ) : (
          <ul className="mt-3 space-y-1">
            {byBalance.map((c) => {
              const bal = balanceOf(c);
              const selected = source === c;
              return (
                <li key={c}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pickSource(c)}
                    className={cn(
                      "w-full rounded-[18px] px-3 py-3 text-left transition-colors",
                      selected ? "bg-[var(--lp-cream)]" : "hover:bg-[var(--lp-cream)]",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <ChainLogo chain={c} size={22} />
                        <span className="truncate text-[15px] font-semibold">{CHAIN_DISPLAY_NAMES[c]}</span>
                        {selected && (
                          <span className="rounded-full bg-[var(--lp-ink)] px-2 py-px text-[11px] font-semibold text-[var(--lp-cream)]">From</span>
                        )}
                      </span>
                      <span className="text-[15px] font-semibold tabular-nums">${bal.toFixed(2)}</span>
                    </span>
                    {/* One series, one hue: the length is the share of what the user holds. */}
                    <span className="mt-2 block h-2 overflow-hidden rounded-full bg-[var(--lp-soft)]">
                      <span
                        className={cn("block h-full rounded-full", selected ? "bg-[#04c96a]" : "bg-[var(--lp-ink)]")}
                        style={{ width: `${largest ? Math.max(3, (bal / largest) * 100) : 0}%` }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One half of the converter: a cream panel inside the forest card. */
function Slot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[28px] bg-[var(--lp-cream)] p-5 text-[var(--lp-ink)] sm:p-6">
      <p className="lp-mono mb-3 text-[12px] uppercase text-[var(--lp-muted)]">{label}</p>
      {children}
    </div>
  );
}

type BridgeChain = SupportedChain | "stellar" | "solana";

/** The network a slot is set to, as a pill that opens the list of networks it can be. */
function NetworkPicker({
  value,
  placeholder,
  options,
  onPick,
  balanceOf,
  disabled,
}: {
  value: BridgeChain | null;
  placeholder: string;
  options: BridgeChain[];
  onPick: (c: BridgeChain) => void;
  /** Shown beside each option when given: the source list says what each network holds. */
  balanceOf?: (c: BridgeChain) => number;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className="inline-flex h-12 min-w-0 items-center gap-2.5 rounded-full bg-[var(--lp-surface)] py-1 pl-1.5 pr-4 text-[16px] font-semibold shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] outline-none transition-shadow hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)] focus-visible:ring-2 focus-visible:ring-[var(--lp-ink)] disabled:cursor-not-allowed disabled:text-[var(--lp-muted)] disabled:hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)]"
      >
        {value ? (
          <ChainLogo chain={value} size={34} />
        ) : (
          <span className="size-[34px] rounded-full border-2 border-dashed border-[rgb(var(--lp-hair)/0.25)]" />
        )}
        <span className="truncate">{value ? CHAIN_DISPLAY_NAMES[value] : placeholder}</span>
        <ChevronDown className="size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 space-y-0.5 rounded-[22px] p-1.5">
        {options.map((c) => (
          <DropdownMenuItem
            key={c}
            onClick={() => onPick(c)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-[16px] px-3 py-2.5 focus:bg-[var(--lp-cream)] focus:text-[var(--lp-ink)]",
              value === c && "bg-[var(--lp-cream)]",
            )}
          >
            <ChainLogo chain={c} size={24} />
            <span className="flex-1 text-[15px] font-semibold">{CHAIN_DISPLAY_NAMES[c]}</span>
            {balanceOf && <span className="text-[13px] tabular-nums text-[var(--lp-muted)]">${balanceOf(c).toFixed(2)}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
