import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ConnectedWallet } from "@privy-io/react-auth";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { bridgeAndDeliver, consolidateFundsToChain } from "@/lib/web3/bridge-actions";
import { toast } from "sonner";
import { parseFriendlyError } from "./useTransfer";
import { SupportedChain, CHAIN_NAMES } from "@/lib/circle/gateway";
import {
  planExternalSend,
  AUTO_SOURCE,
  type ChainBalances,
  type SolanaSource,
  type SourceChainKey,
  type SourcePreference,
} from "@/lib/web3/routing";
import { isAddress } from "viem";

export interface CrossChainSendInfo {
  sourceChain: SupportedChain;
  destChain: SupportedChain;
  amount: string;
  recipient: string;
  /** When true, funds are gathered onto Base (from EVM chains + Solana) before delivery. */
  consolidate?: boolean;
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
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedChain, setSelectedChain] = useState<SupportedChain>("base");
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

  const queryClient = useQueryClient();

  // Fetch security preferences
  useEffect(() => {
    if (senderEmail) {
      fetch(`/api/user/preferences?email=${encodeURIComponent(senderEmail)}`)
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

  // Total spendable across EVM chains — the router decides whether each send is a
  // direct transfer or a bridge, so the whole unified balance is available.
  const spendableNum = Object.values(chainBalances ?? {}).reduce(
    (s, n) => s + (n ?? 0),
    0,
  );
  const balance = spendableNum.toFixed(2);
  const isFetchingBalance = false;

  const handleTransfer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!amount || !recipientAddress || !embeddedProvider) return;

    if (!isAddress(recipientAddress)) {
      toast.error("Invalid recipient wallet address.");
      return;
    }

    setLoading(true);
    setStatus("Initiating transfer...");

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

  // Decide how to fulfil the send once auth (2FA) has passed: a direct same-chain
  // transfer, or a cross-chain bridge (which needs an extra confirmation modal).
  const proceedAfterAuth = async () => {
    const amt = parseFloat(amount);

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
      if ((chainBalances?.[c] ?? 0) + 1e-9 < amt) {
        toast.error(`${CHAIN_NAMES[c]} doesn't hold enough for this send.`);
        setLoading(false);
        setStatus("");
        return;
      }
      if (c === selectedChain) {
        await executeDirectTransfer();
      } else {
        setLoading(false);
        setStatus("");
        setBridgeConfirm({
          sourceChain: c,
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
        (s, k) =>
          s + (k === "solana" ? solanaSource?.balance ?? 0 : chainBalances?.[k] ?? 0),
        0,
      );
      if (sum + 1e-9 < amt) {
        toast.error("Selected networks don't hold enough for this send.");
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

    const plan = planExternalSend(amount, selectedChain, chainBalances ?? {}, {
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

    // No single chain covers it. If the combined balance (EVM + Solana) does, gather
    // funds onto Base first, then deliver to the destination.
    const solBal = solanaSource?.balance ?? 0;
    if (plan.totalAvailable + solBal + 1e-9 >= parseFloat(amount)) {
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
            email: senderEmail,
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
            userEmail: senderEmail,
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
          userEmail: senderEmail,
          actionType: "transfer",
          payload: {
            amount: valUsdc,
            recipientEmail: recipientAddress,
            note: `Crypto transfer on ${CHAIN_NAMES[selectedChain]}`,
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
  };

  const recordSentTransfer = async (
    txHash: string,
    note: string,
    chain: SupportedChain,
  ) => {
    const { recordTransfer } = await import("@/lib/supabase/transactions");
    await recordTransfer({
      senderEmail,
      recipientEmail: recipientAddress,
      amount: parseFloat(amount),
      status: "completed",
      note,
      txHash,
      chain,
    });
  };

  // Same-chain send: the recipient is on a chain the user already holds funds on.
  const executeDirectTransfer = async () => {
    if (!amount || !recipientAddress || !embeddedProvider) return;
    setLoading(true);
    setStatus("Requesting signature...");

    try {
      const provider = await embeddedProvider.getEthereumProvider();
      const txHash = await executeCircleGaslessTransfer(
        provider,
        recipientAddress,
        amount,
        selectedChain,
      );

      toast.success("Transfer completed!");
      setStatus("");
      await recordSentTransfer(
        txHash as string,
        `Crypto transfer on ${CHAIN_NAMES[selectedChain]}`,
        selectedChain,
      );
      invalidateBalances();
      setAmount("");
      setRecipientAddress("");
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
    setBridgeConfirm(null);
    setLoading(true);

    try {
      let txHash: string;

      if (info.consolidate) {
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
        setStatus("Gathering your funds onto Base…");
        await consolidateFundsToChain(embeddedProvider, {
          targetChain: "base",
          requiredAmount: info.amount,
          balances: sourceBalances,
          recipient: smartAddress,
          solana: includeSolana ? solanaSource : undefined,
          onStatus: setStatus,
        });

        if (info.destChain === "base") {
          setStatus("Sending on Base…");
          const provider = await embeddedProvider.getEthereumProvider();
          txHash = await executeCircleGaslessTransfer(
            provider,
            info.recipient,
            info.amount,
            "base",
          );
        } else {
          const { burnTxHash, mintTxHash } = await bridgeAndDeliver(embeddedProvider, {
            sourceChain: "base",
            destChain: info.destChain,
            amountUSDC: info.amount,
            recipient: info.recipient,
            onStatus: setStatus,
          });
          txHash = mintTxHash ?? burnTxHash;
        }
      } else {
        // A single EVM chain covers it — bridge straight to the recipient.
        setStatus(`Bridging from ${CHAIN_NAMES[info.sourceChain]}…`);
        const { burnTxHash, mintTxHash } = await bridgeAndDeliver(embeddedProvider, {
          sourceChain: info.sourceChain,
          destChain: info.destChain,
          amountUSDC: info.amount,
          recipient: info.recipient,
          onStatus: setStatus,
        });
        txHash = mintTxHash ?? burnTxHash;
      }

      setStatus("");
      await recordSentTransfer(
        txHash,
        `Cross-chain transfer to ${CHAIN_NAMES[info.destChain]}`,
        info.destChain,
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

  const isOverBalance = parseFloat(amount || "0") > parseFloat(balance);
  const isZeroBalance = parseFloat(balance) === 0;

  return {
    recipientAddress,
    setRecipientAddress,
    amount,
    setAmount,
    selectedChain,
    setSelectedChain,
    loading,
    status,
    balance,
    isFetchingBalance,
    isOverBalance,
    isZeroBalance,
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
