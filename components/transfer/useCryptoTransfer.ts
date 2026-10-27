import { usePlatformFeePercent } from '@/lib/hooks/usePlatformFeePercent';
import { useState, useEffect, useMemo } from "react";
import { usePinAuthorization } from "@/components/security/PinAuthorizationProvider";
import { noteTransactionAuthorization } from "@/lib/actions/transactionAuth";
import { describeCryptoSend } from "@/lib/signing/describe";
import { quoteFee } from "@/lib/actions/fees";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ConnectedWallet, usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import { Connection } from '@solana/web3.js';
import { solanaRpcUrl } from '@/lib/solana/rpc';
import { NETWORK } from '@/lib/network';
import {
  executeCircleGaslessBatchTransfer,
  executeCircleGaslessTransfer,
} from "@/lib/web3/circle-actions";
import { bridgeAndDeliver, consolidateFundsToChain } from "@/lib/web3/bridge-actions";
import { bridgeStellarToBase, stellarSourceFor } from "@/lib/web3/stellar-bridge";
import { toast } from "sonner";
import { parseFriendlyError } from "./useTransfer";
import { SupportedChain, CHAIN_NAMES } from "@/lib/circle/gateway";
import { recordSendIntent } from "@/lib/actions/pendingSend";
import {
  planExternalSend,
  planSolanaSend,
  AUTO_SOURCE,
  type ChainBalances,
  type SolanaSource,
  type SourceChainKey,
  type SourcePreference,
} from "@/lib/web3/routing";
import { isAddress } from "viem";
import { isStellarReady, useStellarWallet } from "@/hooks/useStellarWallet";

export interface CrossChainSendInfo {
  /**
   * Includes 'stellar': a send can be sourced straight from it when it alone holds the amount.
   * This was typed as EVM-only and the two places that set or read a Stellar source cast their
   * way past it, which is the kind of cast that hides a real mismatch rather than recording one.
   */
  sourceChain: SupportedChain | 'stellar';
  destChain: SupportedChain | 'stellar' | 'solana';
  amount: string;
  recipient: string;
  /** When true, funds are gathered onto Base (from EVM chains + Solana) before delivery. */
  consolidate?: boolean;
  /**
   * Solana destination only: bridge this much from `sourceChain` into the sender's OWN Solana
   * wallet, then send from Solana as usual. See planSolanaSend.
   */
  solanaTopUp?: string;
}

interface UseCryptoTransferProps {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  senderEmail: string;
  /** Per-chain EVM balances used to route the send (direct vs. bridge). */
  chainBalances?: ChainBalances;
  /** Solana source — gathered to Base on demand when EVM funds are short. */
  solanaSource?: SolanaSource;
}



export function useCryptoTransfer({
  smartAddress,
  embeddedProvider,
  senderEmail,
  chainBalances,
  solanaSource,
}: UseCryptoTransferProps) {
  const { getAccessToken } = usePrivy();
  const transferFeePercent = usePlatformFeePercent("transfer");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedChain, setSelectedChain] = useState<SupportedChain | 'stellar' | 'solana'>("base");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  // Cross-chain confirmation: when set, the recipient is on a chain the user has no
  // (or insufficient) funds on, so the send must bridge first — surfaced via a modal.
  const [bridgeConfirm, setBridgeConfirm] = useState<CrossChainSendInfo | null>(null);
  // User source override (default smart auto). Set via the SourceSelector.
  const [sourcePref, setSourcePref] = useState<SourcePreference>(AUTO_SOURCE);

  // 2FA state
  const [twoFaModalOpen, setTwoFaModalOpen] = useState(false);
  const [twoFaOtpId, setTwoFaOtpId] = useState<string | null>(null);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);

  const { wallets: solWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const { authorize } = usePinAuthorization();

  const solanaConnection = useMemo(() => new Connection(solanaRpcUrl(), 'confirmed'), []);

  const queryClient = useQueryClient();
  const { user } = usePrivy();
  const privyUserId = user?.id;

  // The user's Stellar wallet if they have one. Stellar is opt-in (activated from the receive
  // screen), so it is only offered as a network once it is ready.
  const { data: stellarWallet } = useStellarWallet({
    enabled: !!privyUserId,
  });
  const stellarReady = isStellarReady(stellarWallet);

  // Fetch security preferences
  useEffect(() => {
    if (senderEmail) {
      fetch("/api/user/preferences")
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.two_fa_enabled === "boolean") {
            setTwoFaEnabled(data.two_fa_enabled);
            setTwoFaThreshold(data.two_fa_threshold);
            setTotpEnabled(data.totp_enabled || false);
            const credentials = data.webauthn_credentials || [];
            setPasskeyEnabled(
              Array.isArray(credentials) && credentials.length > 0,
            );
          }
        })
        .catch(console.error);
    }
  }, [senderEmail]);

  // Query balance for Stellar when selected, otherwise sum EVM balances
  const { data: stellarUsdcBalance = "0.00", isFetching: isFetchingStellarBalance } = useQuery({
    queryKey: ["balance-stellar", stellarWallet?.address],
    queryFn: async () => {
      if (!stellarWallet?.address) return "0.00";
      const res = await fetch(`/api/stellar/balance?address=${stellarWallet.address}`);
      if (!res.ok) return "0.00";
      const data = await res.json();
      return data.usdc || "0.00";
    },
    enabled: !!stellarWallet?.address,
  });

  const balance = selectedChain === "stellar"
    ? stellarUsdcBalance
    : selectedChain === "solana"
      ? (solanaSource?.balance ?? 0).toFixed(2)
      : (chainBalances?.[selectedChain as SupportedChain] ?? 0).toFixed(2);
  const isFetchingBalance = selectedChain === "stellar" ? isFetchingStellarBalance : false;

  const handleTransfer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!amount || !recipientAddress) return;

    if (selectedChain === "stellar") {
      if (!recipientAddress.startsWith("G") || recipientAddress.length !== 56) {
        toast.error("Invalid Stellar recipient address. It must be a G-address.");
        return;
      }
    } else if (selectedChain === "solana") {
      try {
        const { PublicKey } = await import("@solana/web3.js");
        new PublicKey(recipientAddress);
      } catch {
        toast.error("Invalid Solana recipient address.");
        return;
      }
    } else {
      if (!isAddress(recipientAddress)) {
        toast.error("Invalid recipient wallet address.");
        return;
      }
      if (!embeddedProvider) {
        toast.error("Wallet provider not connected.");
        return;
      }
    }

    setLoading(true);
    // No KYC limit check. Sending is not rationed, and neither is depositing — the one limit in
    // the product is the unverified withdrawal allowance. See lib/kyc/limits.ts.
    setStatus("Starting your transfer…");

    await executeTransferFlow();
  };

  const executeTransferFlow = async () => {
    const valUsdc = parseFloat(amount);
    if (valUsdc >= twoFaThreshold) {
      if (!twoFaEnabled) {
        toast.error(
          `Transfers over ${twoFaThreshold} USDC require 2FA. Please enable it in Settings.`,
        );
        setLoading(false);
        return;
      }
      // 2FA Required - open modal without sending OTP
      setTwoFaModalOpen(true);
      return;
    }

    await proceedAfterAuth();
  };

  /**
   * Take the PIN for this send, and hand back the token the server will ask for.
   *
   * Called from the two places that actually commit — a direct transfer, and a confirmed
   * cross-chain send — rather than once up front. The bridge path puts its own confirmation
   * modal in between, and a PIN taken before that modal would be a PIN taken for something
   * the user had not yet agreed to.
   *
   * `chain` is part of what gets signed for: the same amount to the same address on a
   * different network is a different transaction, and the token should not cover both.
   */
  const requireSendPin = async (
    chain: string,
    sendAmount: string,
    /** Set when the funds have to cross networks to get there — two confirmations, not one. */
    fromChain?: string,
  ): Promise<string | null> => {
    const chainLabel =
      chain === "stellar"
        ? "Stellar"
        : chain === "solana"
          ? "Solana"
          : (CHAIN_NAMES[chain as SupportedChain] ?? chain);

    const token = await authorize({
      purpose: "crypto_transfer",
      payload: { destination: recipientAddress, amount: sendAmount, chain },
      amount: `${parseFloat(sendAmount || "0").toFixed(2)} USDC`,
      destination: recipientAddress,
      warning: "Cannot be undone. Check the address and the network.",
      // The network is not in the headline and getting it wrong loses the money, so it stays.
      details: [{ label: "Network", value: chainLabel }],
      plan: describeCryptoSend({
        amount: sendAmount,
        recipient: recipientAddress,
        destChain: chain,
        sourceChain: fromChain,
      }),
      confirmLabel: "Send",
    });

    if (!token) {
      setLoading(false);
      setStatus("");
    }
    return token;
  };

  // Decide how to fulfil the send once auth (2FA) has passed: a direct same-chain
  // transfer, or a cross-chain bridge (which needs an extra confirmation modal).
  const proceedAfterAuth = async () => {
    const amt = parseFloat(amount);
    const feePercent = transferFeePercent ?? 0;
    const totalNeeded = amt * (1 + feePercent / 100);

    if (selectedChain === "stellar") {
      await executeDirectTransfer();
      return;
    }

    if (selectedChain === "solana") {
      // Solana short: bring the gap over from an EVM chain rather than let the send fail
      // on-chain for want of USDC.
      const plan = planSolanaSend(totalNeeded, solanaSource?.balance ?? 0, chainBalances ?? {});
      if (plan.mode === "direct") {
        await executeDirectTransfer();
        return;
      }
      setLoading(false);
      setStatus("");
      if (plan.mode === "top_up" && embeddedProvider) {
        setBridgeConfirm({
          sourceChain: plan.sourceChain,
          destChain: "solana",
          amount,
          recipient: recipientAddress,
          solanaTopUp: plan.amount,
        });
        return;
      }
      toast.error("Not enough USDC on Solana for this send, and no other network can cover the difference.");
      return;
    }

    // User override: pay entirely from one chosen chain.
    if (sourcePref.mode === "single") {
      const c = sourcePref.chain;
      // Sending a P2P transfer directly from Solana isn't supported here (off-ramp only).
      if (c === "solana") {
        toast.error("Sending directly from Solana isn't supported yet.");
        setLoading(false);
        setStatus("");
        return;
      }
      if (c === "stellar") {
        toast.error("Bridging from Stellar is not supported.");
        setLoading(false);
        setStatus("");
        return;
      }

      const evmChain = c as SupportedChain;
      if ((chainBalances?.[evmChain] ?? 0) + 1e-9 < totalNeeded) {
        toast.error(`${CHAIN_NAMES[evmChain]} doesn't hold enough for this send (including fees).`);
        setLoading(false);
        setStatus("");
        return;
      }
      if (evmChain === selectedChain) {
        await executeDirectTransfer();
      } else {
        setLoading(false);
        setStatus("");
        setBridgeConfirm({
          sourceChain: evmChain,
          destChain: selectedChain,
          amount,
          recipient: recipientAddress,
        });
      }
      return;
    }

    // User override: combine chosen networks onto Base, then deliver.
    if (sourcePref.mode === "consolidate") {
      const sum = sourcePref.from.reduce(
        (s, k) => {
          if (k === "solana") return s + (solanaSource?.balance ?? 0);
          if (k === "stellar") return s;
          return s + (chainBalances?.[k] ?? 0);
        },
        0,
      );
      if (sum + 1e-9 < totalNeeded) {
        toast.error("Selected networks don't hold enough for this send (including fees).");
        setLoading(false);
        setStatus("");
        return;
      }
      setLoading(false);
      setStatus("");
      setBridgeConfirm({
        sourceChain: "base",
        destChain: selectedChain,
        amount,
        recipient: recipientAddress,
        consolidate: true,
      });
      return;
    }

    const plan = planExternalSend(totalNeeded.toFixed(6), selectedChain, chainBalances ?? {}, {
      homeChain: "base",
    });

    if (plan.mode === "direct") {
      await executeDirectTransfer();
      return;
    }

    if (plan.mode === "bridge" && plan.sourceChain) {
      // A single EVM chain covers it — bridge straight from there to the recipient.
      setLoading(false);
      setStatus("");
      setBridgeConfirm({
        sourceChain: plan.sourceChain,
        destChain: selectedChain,
        amount,
        recipient: recipientAddress,
      });
      return;
    }

    const solBal = solanaSource?.balance ?? 0;
    const stellarBal = parseFloat(stellarUsdcBalance) || 0;

    // If Stellar alone holds the full amount for a send to any destination chain, bridge directly from Stellar.
    if (stellarBal + 1e-9 >= totalNeeded && stellarWallet?.address && (selectedChain as string) !== "stellar" && (selectedChain as string) !== "solana") {
      setLoading(false);
      setStatus("");
      setBridgeConfirm({
        sourceChain: "stellar",
        destChain: selectedChain,
        amount,
        recipient: recipientAddress,
      });
      return;
    }

    // No single chain covers it. If the combined balance (EVM + Solana + Stellar) does, gather
    // funds onto Base first, then deliver to the destination.
    if (plan.totalAvailable + solBal + stellarBal + 1e-9 >= totalNeeded) {
      setLoading(false);
      setStatus("");
      setBridgeConfirm({
        sourceChain: "base",
        destChain: selectedChain,
        amount,
        recipient: recipientAddress,
        consolidate: true,
      });
      return;
    }

    toast.error("Insufficient balance to complete this transfer.");
    setLoading(false);
    setStatus("");
  };

  const handleTwoFaSubmit = async (
    code: string,
    method?: "email" | "totp" | "passkey",
  ) => {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      let res;

      if (method === "passkey") {
        setTwoFaModalOpen(false);
        await proceedAfterAuth();
        return;
      }

      if (method === "totp") {
        res = await fetch("/api/2fa/totp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: code,
            method: "totp",
          }),
        });
      } else {
        if (!twoFaOtpId) return;
        res = await fetch("/api/2fa/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            otp_id: twoFaOtpId,
            otp_code: code,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");

      setTwoFaModalOpen(false);
      setTwoFaOtpId(null);
      await proceedAfterAuth();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Invalid code";
      setTwoFaError(errorMessage);
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleTwoFaResend = async () => {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      const valUsdc = parseFloat(amount);
      const res = await fetch("/api/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionType: "transfer",
          payload: {
            amount: valUsdc,
            recipientEmail: recipientAddress,
            note: `Crypto transfer on ${selectedChain === "stellar" ? "Stellar" : selectedChain === "solana" ? "Solana" : CHAIN_NAMES[selectedChain]}`,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend code");
      setTwoFaOtpId(data.otp_id);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to resend code";
      setTwoFaError(errorMessage);
    } finally {
      setTwoFaLoading(false);
    }
  };

  const handleTwoFaClose = () => {
    setTwoFaModalOpen(false);
    setLoading(false);
    setStatus("");
    setTwoFaError(null);
  };

  const invalidateBalances = () => {
    queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    queryClient.invalidateQueries({ queryKey: ["cross-chain-balances"] });
    queryClient.invalidateQueries({ queryKey: ["history", senderEmail] });
    if (stellarWallet?.address) {
      queryClient.invalidateQueries({ queryKey: ["balance-stellar", stellarWallet.address] });
    }
  };

  const recordSentTransfer = async (
    txHash: string,
    note: string,
    chain: SupportedChain | 'stellar' | 'solana',
    legs?: { chain: string; txHash: string; amount: number }[],
  ) => {
    const { recordTransfer } = await import("@/lib/supabase/transactions");
    await recordTransfer({
      recipientEmail: recipientAddress,
      amount: parseFloat(amount),
      status: "completed",
      note,
      txHash,
      chain,
      legs,
    });
  };

  // Same-chain send: the recipient is on a chain the user already holds funds on.
  /**
   * The platform fee for a send to an external wallet, or null when there's none to charge.
   *
   * Throws if the chain has no treasury configured rather than sending fee-free — the same
   * fail-closed rule the off-ramp uses, so a misconfigured chain is loud instead of silently
   * giving the service away.
   */
  const resolveTransferFee = async (
    chain: string,
    amountUsdc: string,
  ): Promise<{ usdc: string; treasury: string } | null> => {
    const token = await getAccessToken().catch(() => null);
    const quote = await quoteFee("transfer", chain, parseFloat(amountUsdc), token ?? undefined);
    if (quote.fee <= 0) return null;
    if (!quote.treasury) {
      throw new Error(
        `Sending on ${chain} is unavailable right now. Please try another network.`,
      );
    }
    return { usdc: quote.fee.toFixed(6), treasury: quote.treasury };
  };

  /** The user's Privy Solana wallet and its signer, or a thrown "no wallet". */
  const resolveSolanaWallet = () => {
    const solAccount = user?.linkedAccounts.find(
      (a) =>
        a.type === 'wallet' &&
        (a as { walletClientType?: string }).walletClientType === 'privy' &&
        (a as { chainType?: string }).chainType === 'solana',
    );
    const solAddress =
      solAccount && 'address' in solAccount
        ? (solAccount as { address: string }).address
        : undefined;
    const solWallet = solWallets.find((w) => w.address === solAddress) ?? null;
    if (!solAddress || !solWallet) {
      throw new Error("No Solana wallet found. Please link a Solana wallet first.");
    }
    return { solAddress, solWallet };
  };

  /**
   * Send `amount` (+ fee, + memo) to the recipient from the user's Solana wallet.
   *
   * Returns the signature once confirmed. Returns null when it was broadcast but is still
   * confirming — that case is fully handled here (the user is told, the form is cleared, and the
   * history row is written from the page once the chain shows it), so the caller just stops.
   */
  const sendOnSolana = async (): Promise<string | null> => {
    const { solAddress, solWallet } = resolveSolanaWallet();
    const { buildSolanaUsdcTransferTx } = await import("@/lib/solana/usdc-transfer");
    const { sendSponsoredSolanaTx, waitForSolanaSignature } = await import(
      "@/lib/web3/solana-sponsored-send"
    );
    setStatus("Preparing your transfer on Solana…");
    const tx = await buildSolanaUsdcTransferTx({
      connection: solanaConnection,
      senderAddress: solAddress,
      recipientAddress,
      amount,
      platformFee: (await resolveTransferFee("solana", amount)) ?? undefined,
      memo: memo || undefined,
    });

    // Gas, and the rent for a recipient's first USDC account, are ours: the server prepares the
    // transaction, the user signs it here, and the server co-signs and broadcasts.
    const result = await sendSponsoredSolanaTx({
      tx,
      sign: async (prepared) =>
        (
          await signTransaction({
            transaction: prepared.serialize({
              requireAllSignatures: false,
              verifySignatures: false,
            }),
            wallet: solWallet,
            chain: NETWORK.solana.privyCluster,
          })
        ).signedTransaction,
      record: {
        recipient: recipientAddress,
        amount: parseFloat(amount),
        note: memo ? memo : `Crypto transfer on Solana`,
      },
      onStatus: setStatus,
    });

    if (!result.pending) return result.txHash;

    // Broadcast but not yet confirmed — the Stellar rule: never look like a failure the user
    // should retry.
    toast.info(
      `Your ${amount} USDC is still confirming on Solana. Your funds are safe — ` +
        `please don't send it again; it will appear in your history shortly.`,
    );
    // The server writes the history row once the send confirms (recordedByServer), so it does
    // not depend on this tab staying open; the page only refreshes balances when it sees it.
    void waitForSolanaSignature(solanaConnection, result.txHash).then((landed) => {
      if (landed) invalidateBalances();
    });
    invalidateBalances();
    setAmount("");
    setRecipientAddress("");
    setMemo("");
    setStatus("");
    setLoading(false);
    return null;
  };

  const executeDirectTransfer = async () => {
    if (!amount || !recipientAddress) return;
    if (selectedChain !== "stellar" && selectedChain !== "solana" && !embeddedProvider) {
      return;
    }

    const authorization = await requireSendPin(selectedChain, amount);
    if (!authorization) return;

    setLoading(true);
    setStatus("Confirming your transfer…");

    try {
      // EVM and Solana sign in the page, so this records the PIN rather than enforcing it.
      // The Stellar branch below is different: the server broadcasts there, so it is handed
      // the token and refuses the send without it.
      if (selectedChain !== "stellar") {
        void noteTransactionAuthorization({
          token: authorization,
          purpose: "crypto_transfer",
          payload: { destination: recipientAddress, amount, chain: selectedChain },
        }).catch(() => undefined);
      }

      let txHash: string;

      if (selectedChain === "stellar") {
        if (!isStellarReady(stellarWallet)) {
          toast.error("Activate your Stellar address from Deposit → Receive first.");
          setLoading(false);
          return;
        }
        const currentWallet = stellarWallet;

        setStatus("Sending on Stellar…");
        const res = await fetch("/api/stellar/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: currentWallet.walletId,
            senderAddress: currentWallet.address,
            recipientAddress,
            amount,
            memo: memo || undefined,
            authorization,
          }),
        });
        const data = await res.json();

        // Broadcast but not yet confirmed. The money may well be on its way, so the one thing
        // this must not do is look like a failure the user should retry. Nothing is recorded —
        // the reconciler writes the row if and when the chain confirms it.
        if (data.pending) {
          toast.info(
            `Your ${amount} USDC is still confirming on Stellar. Your funds are safe — ` +
              `please don't send it again; it will appear in your history shortly.`,
          );
          invalidateBalances();
          setStatus("");
          setLoading(false);
          return;
        }

        if (!res.ok) {
          throw new Error(data.error || "Stellar transfer failed");
        }
        txHash = data.txHash;
      } else if (selectedChain === "solana") {
        const sent = await sendOnSolana();
        if (!sent) return;
        txHash = sent;
      } else {
        if (!embeddedProvider) throw new Error("Wallet provider not connected.");
        const provider = await embeddedProvider.getEthereumProvider();
        // Fee rides in the same gasless UserOp as the transfer, so the recipient's USDC and
        // ours move together or not at all.
        const fee = await resolveTransferFee(selectedChain, amount);

        // File the intent the moment the bundler accepts, before the wait for inclusion. If that
        // wait times out, or this tab closes, the reconciler can still finish the job — see
        // lib/supabase/pendingSends.ts.
        const onBroadcast = (userOpHash: string) =>
          recordSendIntent({
            userOpHash,
            chain: selectedChain,
            recipient: recipientAddress,
            amount: parseFloat(amount),
            note: `Crypto transfer on ${CHAIN_NAMES[selectedChain]}`,
          });

        txHash = fee
          ? await executeCircleGaslessBatchTransfer(
              provider,
              [
                { recipientAddress, amountUSDC: amount },
                { recipientAddress: fee.treasury, amountUSDC: fee.usdc },
              ],
              selectedChain,
              onBroadcast,
            )
          : await executeCircleGaslessTransfer(
              provider,
              recipientAddress,
              amount,
              selectedChain,
              onBroadcast,
            );
      }

      toast.success("Transfer completed!");
      setStatus("");

      if (selectedChain === "stellar") {
        await recordSentTransfer(
          txHash,
          memo ? memo : `Crypto transfer on Stellar`,
          'stellar'
        );
      } else if (selectedChain === "solana") {
        await recordSentTransfer(
          txHash,
          memo ? memo : `Crypto transfer on Solana`,
          'solana'
        );
      } else {
        await recordSentTransfer(
          txHash as string,
          `Crypto transfer on ${CHAIN_NAMES[selectedChain]}`,
          selectedChain,
        );
      }
      
      invalidateBalances();
      setAmount("");
      setRecipientAddress("");
      setMemo("");
      setSourcePref(AUTO_SOURCE);
    } catch (err) {
      console.error("[Crypto Transfer] Fatal Error:", err);
      toast.error(parseFriendlyError(err));
      setStatus("");
    }
    setLoading(false);
  };

  // Cross-chain send: bridge from a funded chain and deliver to the recipient on the
  // destination chain. Invoked after the user confirms the bridge modal.
  const confirmBridgeSend = async () => {
    const info = bridgeConfirm;
    if (!info || !embeddedProvider) return;

    // Asked for after the cross-chain confirmation, not before it — the PIN approves the send
    // the user has just agreed to the shape of, including which network it lands on.
    const authorization = await requireSendPin(
      info.destChain,
      info.amount,
      info.sourceChain,
    );
    if (!authorization) return;

    setBridgeConfirm(null);
    setLoading(true);

    try {
      // Paid from Stellar, the server signs the burn to the recipient and spends this token
      // itself, so it is handed over rather than noted here (noting spends it).
      if (info.sourceChain !== "stellar") {
        void noteTransactionAuthorization({
          token: authorization,
          purpose: "crypto_transfer",
          payload: {
            destination: recipientAddress,
            amount: info.amount,
            chain: info.destChain,
          },
        }).catch(() => undefined);
      }

      // What the ledger records: the transaction that moved the sender's USDC, on the chain it
      // moved on. For a bridge that is the burn on the SOURCE chain — the mint on the
      // destination never involves the sender's wallet, so it cannot be checked as their send,
      // and recording it against the destination chain had every cross-chain send refused.
      let txHash: string;
      let txChain: SupportedChain | "stellar" | "solana" = info.destChain;
      let movedAmount = parseFloat(info.amount);

      if (info.destChain === "solana" && info.solanaTopUp) {
        // Top up the sender's own Solana wallet from an EVM chain, then send from Solana. The
        // burn is to ourselves, so the history row is the Solana send — the payment the
        // recipient actually got. bridgeAndDeliver records the burn on its own.
        const { solAddress } = resolveSolanaWallet();
        setStatus("Moving funds to Solana…");
        await bridgeAndDeliver(embeddedProvider, {
          sourceChain: info.sourceChain as SupportedChain,
          destChain: "solana",
          amountUSDC: info.solanaTopUp,
          recipient: solAddress,
          solanaWallet: { address: solAddress },
          onStatus: undefined,
        });
        const sent = await sendOnSolana();
        if (!sent) return;
        txHash = sent;
        txChain = "solana";
      } else if (info.consolidate) {
        // Gather funds onto Base, then deliver. Honour the user's chosen networks if set.
        const from = sourcePref.mode === "consolidate" ? sourcePref.from : null;
        const allBalances = chainBalances ?? {};
        const sourceBalances: ChainBalances = from
          ? Object.fromEntries(
              (Object.keys(allBalances) as (keyof ChainBalances)[])
                .filter((c) => from.includes(c as SourceChainKey))
                .map((c) => [c, allBalances[c]]),
            )
          : allBalances;
        const includeSolana = from ? from.includes("solana") : true;
        const includeStellar = from ? from.includes("stellar") : true;
        const stellarBal = parseFloat(stellarUsdcBalance) || 0;
        const feePercent = transferFeePercent ?? 0;
        const totalRequiredAmount = (parseFloat(info.amount) * (1 + feePercent / 100)).toFixed(6);

        // `onStatus` is withheld from every bridge call below.
        //
        // The engine narrates itself — "Burn confirmed! Minting on Polygon…", "Delivering on
        // Arbitrum…" — and none of that is the transaction the user started. They asked to send
        // money to someone; the networks it crossed on the way are our plumbing, and naming them
        // only invites "what is Arbitrum and why is my money on it?". The step INDEX is still
        // surfaced, which is what moves the tracker.
        setStatus("Preparing your transfer…");
        await consolidateFundsToChain(embeddedProvider, {
          targetChain: "base",
          requiredAmount: totalRequiredAmount,
          balances: sourceBalances,
          recipient: smartAddress,
          solana: includeSolana ? solanaSource : undefined,
          stellar: includeStellar ? stellarSourceFor(stellarWallet, stellarBal, embeddedProvider) : undefined,
          onStatus: undefined,
        });

        if (info.destChain === "base") {
          setStatus("Sending on Base…");
          const provider = await embeddedProvider.getEthereumProvider();
          const fee = await resolveTransferFee("base", info.amount);
          txHash = fee
            ? await executeCircleGaslessBatchTransfer(
                provider,
                [
                  { recipientAddress: info.recipient, amountUSDC: info.amount },
                  { recipientAddress: fee.treasury, amountUSDC: fee.usdc },
                ],
                "base",
              )
            : await executeCircleGaslessTransfer(
                provider,
                info.recipient,
                info.amount,
                "base",
              );
        } else {
          const { burnTxHash } = await bridgeAndDeliver(embeddedProvider, {
            sourceChain: "base",
            destChain: info.destChain as SupportedChain,
            amountUSDC: info.amount,
            recipient: info.recipient,
            onStatus: undefined,
          });
          txHash = burnTxHash;
          txChain = "base";
        }
      } else if (info.sourceChain === "stellar") {
        setStatus(`Sending on ${CHAIN_NAMES[info.destChain as SupportedChain]}…`);
        if (!stellarWallet?.address) throw new Error("Stellar wallet not connected.");
        const feePercent = transferFeePercent ?? 0;
        const totalAmountWithFee = (parseFloat(info.amount) * (1 + feePercent / 100)).toFixed(6);
        const { burnTxHash } = await bridgeStellarToBase({
          walletId: stellarWallet.walletId,
          senderAddress: stellarWallet.address,
          amount: totalAmountWithFee,
          recipientEvm: info.recipient,
          evmWallet: embeddedProvider,
          destChain: info.destChain as SupportedChain,
          onStatus: undefined,
          authorization,
          authorizedAmount: info.amount,
        });
        txHash = burnTxHash;
        txChain = "stellar";
        // The fee rides inside this one burn, so it moved more than the amount sent.
        movedAmount = parseFloat(totalAmountWithFee);
      } else {
        // A single EVM chain covers it — bridge straight to the recipient.
        setStatus(`Sending on ${CHAIN_NAMES[info.destChain as SupportedChain]}…`);
        const { burnTxHash } = await bridgeAndDeliver(embeddedProvider, {
          sourceChain: info.sourceChain,
          destChain: info.destChain as SupportedChain,
          amountUSDC: info.amount,
          recipient: info.recipient,
          onStatus: undefined,
        });
        txHash = burnTxHash;
        txChain = info.sourceChain;
      }

      setStatus("");
      await recordSentTransfer(
        txHash,
        `Cross-chain transfer to ${info.destChain === "stellar" ? "Stellar" : info.destChain === "solana" ? "Solana" : CHAIN_NAMES[info.destChain as SupportedChain]}`,
        txChain,
        [{ chain: txChain, txHash, amount: movedAmount }],
      );
      invalidateBalances();
      toast.success("Transfer delivered!");
      setAmount("");
      setRecipientAddress("");
    } catch (err) {
      console.error("[Crypto Transfer] Bridge error:", err);
      toast.error(parseFriendlyError(err));
      setStatus("");
    }
    setLoading(false);
  };

  const cancelBridgeSend = () => {
    setBridgeConfirm(null);
    setLoading(false);
    setStatus("");
  };

  /**
   * What the router can actually gather for this send — not just the selected chain.
   *
   * `handleTransfer` already falls back to consolidating other networks onto Base and
   * delivering from there, but the submit button was gated on the SELECTED chain's balance
   * alone. So the moment no single chain covered the amount, the button read "Exceeds balance"
   * and disabled itself — making that consolidation path unreachable from the UI even when the
   * user had plenty across chains.
   *
   * Mirrors exactly what the router can reach: EVM chains plus Solana. Stellar only counts when
   * it's the selected chain, since nothing gathers Stellar funds onto Base.
   */
  const evmSpendable = Object.values(chainBalances ?? {}).reduce<number>(
    (sum, v) => sum + (v ?? 0),
    0,
  );
  const spendable =
    evmSpendable +
    (solanaSource?.balance ?? 0) +
    (parseFloat(stellarUsdcBalance) || 0);

  // The wallet has to cover the amount AND the platform fee charged alongside it.
  const requiredTotal =
    (parseFloat(amount || "0") || 0) *
    (1 + (transferFeePercent ?? 0) / 100);

  const isOverBalance = requiredTotal > spendable + 1e-9;
  const isZeroBalance = spendable === 0;

  return {
    recipientAddress,
    setRecipientAddress,
    amount,
    setAmount,
    selectedChain,
    setSelectedChain,
    memo,
    setMemo,
    loading,
    status,
    balance,
    spendable,
    transferFeePercent,
    isFetchingBalance,
    isOverBalance,
    isZeroBalance,
    stellarReady,
    handleTransfer,
    twoFaModalOpen,
    setTwoFaModalOpen,
    twoFaLoading,
    twoFaError,
    handleTwoFaSubmit,
    handleTwoFaResend,
    totpEnabled,
    passkeyEnabled,
    handleTwoFaClose,
    bridgeConfirm,
    confirmBridgeSend,
    cancelBridgeSend,
    sourcePref,
    setSourcePref,
    chainBalances: chainBalances ?? {},
    solanaBalance: solanaSource?.balance ?? 0,
  };
}
