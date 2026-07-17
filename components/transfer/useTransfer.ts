import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUserContacts } from "@/components/contacts/useContacts";
import { useExchangeRate } from "@/lib/hooks/useExchangeRate";
import { ConnectedWallet } from "@privy-io/react-auth";
import { executeRoutedTransfer } from "@/lib/web3/circle-actions";
import { consolidateFundsToChain } from "@/lib/web3/bridge-actions";
import {
  planTransferRoute,
  AUTO_SOURCE,
  type ChainBalances,
  type SolanaSource,
  type SourcePreference,
} from "@/lib/web3/routing";
import { CHAIN_NAMES } from "@/lib/circle/gateway";
import { sendTransferEmail } from "@/lib/email/sendEmail";
import { type FiatCurrencyCode } from "@/lib/currency-config";
import { ReceiptData } from "@/lib/receipt/types";
import { toast } from "sonner";

// Custom 2FA limit will be fetched from user preferences
/** Convert raw viem / Circle / network errors into short user-readable strings. */
export function parseFriendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Circle / viem UserOperation errors contain multi-KB hex calldata — catch first
  if (
    raw.includes("executing user operation") ||
    raw.includes("UserOperation")
  ) {
    // Must be checked before the generic "JSON is not a valid request object" branch —
    // Circle wraps this specific error inside that same outer message.
    if (
      raw.includes("Cannot find target wallet") ||
      raw.includes("wallet doesn't exist")
    )
      return "Wallet not registered with transfer service. Please try again — your wallet is being set up.";
    if (raw.includes("JSON is not a valid request object"))
      return "Transfer service is temporarily unavailable. Please try again shortly.";
    if (raw.includes("AA21") || raw.includes("didn't pay prefund"))
      return "Insufficient funds to cover the network fee.";
    if (
      raw.includes("precheck failed") ||
      raw.includes("sender balance and deposit together")
    )
      return "Transfer failed. Please try again.";
    if (raw.includes("AA25") || raw.includes("invalid account nonce"))
      return "Transaction conflict — please wait a moment and retry.";
    if (/rejected|denied/i.test(raw)) return "Transaction rejected by network.";
    return "Transfer failed. Please try again.";
  }

  if (/user rejected|user denied|cancelled/i.test(raw))
    return "Transaction cancelled.";
  if (/insufficient funds|insufficient balance/i.test(raw))
    return "Insufficient balance to complete this transfer.";
  if (/network|fetch|ECONNREFUSED|timeout/i.test(raw))
    return "Network error. Please check your connection and try again.";
  if (raw.includes("Circle Client Key not configured"))
    return "Transfer service is not configured. Please contact support.";

  // Only surface the raw message if it's short enough to be readable
  return raw.length <= 120 ? raw : "Transfer failed. Please try again.";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface RecipientCheckState {
  status: "idle" | "loading" | "done";
  exists: boolean;
  priorTransactionCount: number;
}

interface UseTransferProps {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  balance: string;
  /** Per-chain EVM balances used by the routing engine to source funds. */
  chainBalances?: ChainBalances;
  /** Solana source — bridged to Base on demand when EVM funds are short. */
  solanaSource?: SolanaSource;
  senderEmail: string;
  initialRecipientEmail?: string;
  onClearInitialRecipient?: () => void;
  stellarAddress?: string;
  stellarWalletId?: string;
  stellarBalance?: number;
}

export function useTransfer({
  smartAddress,
  embeddedProvider,
  balance,
  chainBalances,
  solanaSource,
  senderEmail,
  initialRecipientEmail,
  onClearInitialRecipient,
  stellarAddress,
  stellarWalletId,
  stellarBalance,
}: UseTransferProps) {
  const [recipientEmail, setRecipientEmail] = useState(
    initialRecipientEmail || "",
  );
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | FiatCurrencyCode>("USD");
  const [memo, setMemo] = useState("");
  // User source override (default smart auto). p2p only offers auto + single chain.
  const [sourcePref, setSourcePref] = useState<SourcePreference>(AUTO_SOURCE);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [isPendingClaim, setIsPendingClaim] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [lastRecipient, setLastRecipient] = useState("");
  const [lastCompletedTransfer, setLastCompletedTransfer] =
    useState<ReceiptData | null>(null);
  const [recipientCheck, setRecipientCheck] =
    useState<RecipientCheckState | null>(null);
  const [twoFaModalOpen, setTwoFaModalOpen] = useState(false);
  const [twoFaOtpId, setTwoFaOtpId] = useState<string | null>(null);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);
  const [warningModalOpen, setWarningModalOpen] = useState(false);

  // Cache recipient check results for 30s to avoid hammering on keystrokes
  const checkCacheRef = useRef<
    Map<
      string,
      { data: { exists: boolean; priorTransactionCount: number }; ts: number }
    >
  >(new Map());

  const isFiat = currency !== "USD";
  const { data: exchangeRate = 1 } = useExchangeRate(isFiat ? currency : "USD");
  const queryClient = useQueryClient();

  const { data: contacts = [] } = useUserContacts(senderEmail);

  useEffect(() => {
    if (initialRecipientEmail) {
      setRecipientEmail(initialRecipientEmail);
      if (onClearInitialRecipient) onClearInitialRecipient();
    }

    // Fetch security preferences
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
  }, [initialRecipientEmail, onClearInitialRecipient, senderEmail]);

  // Debounced recipient check — fires 500ms after the email field settles
  useEffect(() => {
    const emailLower = recipientEmail.toLowerCase().trim();

    if (!emailLower || !isValidEmail(emailLower)) {
      setRecipientCheck(null);
      return;
    }
    // Don't warn when sending to yourself
    if (emailLower === senderEmail.toLowerCase()) {
      setRecipientCheck(null);
      return;
    }

    const timer = setTimeout(async () => {
      // Check 30-second cache first
      const cached = checkCacheRef.current.get(emailLower);
      if (cached && Date.now() - cached.ts < 30_000) {
        setRecipientCheck({ status: "done", ...cached.data });
        return;
      }

      setRecipientCheck({
        status: "loading",
        exists: false,
        priorTransactionCount: 0,
      });
      try {
        const res = await fetch(
          `/api/transfer/check-recipient?email=${encodeURIComponent(emailLower)}&senderEmail=${encodeURIComponent(senderEmail)}`,
        );
        if (res.ok) {
          const data = await res.json();
          checkCacheRef.current.set(emailLower, { data, ts: Date.now() });
          setRecipientCheck({ status: "done", ...data });
        } else {
          setRecipientCheck(null);
        }
      } catch {
        setRecipientCheck(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [recipientEmail, senderEmail]);

  const amountUsdc = isFiat
    ? (parseFloat(amount || "0") / exchangeRate).toFixed(2)
    : amount;

  const handleTransfer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!amount || !recipientEmail || !embeddedProvider) return;

    setLoading(true);
    setStatus("Checking transaction history...");

    try {
      const emailLower = recipientEmail.toLowerCase().trim();
      const res = await fetch(
        `/api/transfer/check-recipient?email=${encodeURIComponent(emailLower)}&senderEmail=${encodeURIComponent(senderEmail)}`,
      );
      if (res.ok) {
        const checkData = await res.json();
        setRecipientCheck({ status: "done", ...checkData });

        if (checkData.priorTransactionCount === 0) {
          setWarningModalOpen(true);
          setLoading(false);
          setStatus("");
          return;
        }
      }
    } catch (err) {
      console.error("[Transfer] Check recipient error:", err);
    }

    await executeTransferFlow();
  };

  const handleWarningConfirm = async () => {
    setWarningModalOpen(false);
    await executeTransferFlow();
  };

  const handleTwoFaClose = () => {
    setTwoFaModalOpen(false);
    setLoading(false);
    setStatus("");
    setTwoFaError(null);
  };

  const executeTransferFlow = async () => {
    const valUsdc = parseFloat(amountUsdc);
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

    await executeTransferActual();
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
        // Passkey is already verified, just proceed with the actual transfer
        setTwoFaModalOpen(false);
        await executeTransferActual();
        return;
      }

      if (method === "totp") {
        // Use TOTP verification endpoint
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
        // Use email OTP verification endpoint
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
      await executeTransferActual();
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
      const valUsdc = parseFloat(amountUsdc);
      const res = await fetch("/api/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail: senderEmail,
          actionType: "transfer",
          payload: { amount: valUsdc, recipientEmail, note: memo },
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

  const executeTransferActual = async () => {
    if (!amount || !recipientEmail || !embeddedProvider) return;
    setLoading(true);
    setLastCompletedTransfer(null);
    setStatus("Looking up recipient...");
    setIsPendingClaim(false);

    try {
      const { getUserAddressByEmail } = await import("@/lib/supabase/users");
      let recipientAddress = await getUserAddressByEmail(recipientEmail);

      if (!recipientAddress) {
        setIsPendingClaim(true);
        setStatus("Recipient not found. Generating secure wallet...");

        const res = await fetch("/api/wallets/pre-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: recipientEmail }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to pre-generate wallet");
        }

        recipientAddress = data.address as string;
        setStatus("Ready to send to new wallet...");
      } else {
        setStatus("Identity confirmed. Requesting signature...");
      }

      const provider = await embeddedProvider.getEthereumProvider();

      // Source funds from wherever the sender holds them. The recipient owns the same
      // address on every EVM chain, so each leg is a plain same-chain transfer — no bridge.
      const balancesForRoute: ChainBalances =
        chainBalances && Object.keys(chainBalances).length > 0
          ? chainBalances
          : { base: parseFloat(balance) || 0 };

      let plan = planTransferRoute(amountUsdc, balancesForRoute, {
        homeChain: "base",
        source: sourcePref,
      });

      // A manual single-chain choice that can't cover the amount: don't silently
      // fall back to consolidation — tell the user.
      if (sourcePref.mode === "single" && !plan.feasible) {
        const label =
          sourcePref.chain === "solana" ? "Solana" : CHAIN_NAMES[sourcePref.chain];
        toast.error(`${label} doesn't hold enough for this transfer.`);
        setLoading(false);
        setStatus("");
        return;
      }

      if (!plan.feasible) {
        // EVM alone can't cover it — pull in Solana or Stellar (bridged to Base) if that closes
        // the gap, then send everything from Base.
        const solBal = solanaSource?.balance ?? 0;
        const stelBal = stellarBalance ?? 0;
        if (plan.totalAvailable + solBal + stelBal + 1e-9 >= parseFloat(amountUsdc)) {
          setStatus("Preparing your funds across networks…");

          const stellarSource = (stellarAddress && stellarWalletId && stelBal > 0)
            ? {
                walletId: stellarWalletId,
                address: stellarAddress,
                balance: stelBal,
                bridgeToBase: async (amt: string, recipient: string, onStatus?: (status: string) => void) => {
                  const { bridgeStellarToBase } = await import("@/lib/web3/stellar-bridge");
                  await bridgeStellarToBase({
                    walletId: stellarWalletId,
                    senderAddress: stellarAddress,
                    amount: amt,
                    recipientEvm: recipient,
                    evmWallet: embeddedProvider,
                    onStatus,
                  });
                }
              }
            : undefined;

          await consolidateFundsToChain(embeddedProvider, {
            targetChain: "base",
            requiredAmount: amountUsdc,
            balances: balancesForRoute,
            recipient: smartAddress,
            solana: solanaSource,
            stellar: stellarSource,
            onStatus: setStatus,
          });
          plan = {
            feasible: true,
            legs: [{ chain: "base", amount: amountUsdc }],
            totalAvailable: parseFloat(amountUsdc),
            requested: parseFloat(amountUsdc),
            multiSource: false,
          };
        } else {
          throw new Error("Insufficient balance to complete this transfer.");
        }
      }

      setStatus(
        plan.multiSource
          ? `Sending across ${plan.legs.length} networks...`
          : `Sending on ${CHAIN_NAMES[plan.legs[0].chain]}...`,
      );

      const txHashes = await executeRoutedTransfer(
        provider,
        recipientAddress as string,
        plan.legs,
      );
      const txHash = txHashes[0];

      toast.success("Transfer completed!");
      setStatus("");

      setLastCompletedTransfer({
        id: (txHash as string) || `txn-${Date.now().toString(36)}`,
        type: "sent",
        status: "completed",
        timestamp: new Date().toISOString(),
        amountUsdc: parseFloat(amountUsdc),
        senderEmail,
        recipientEmail,
        note: memo || undefined,
        txHash: txHash as string,
      });

      const { recordTransfer } = await import("@/lib/supabase/transactions");
      await recordTransfer({
        senderEmail,
        recipientEmail,
        amount: parseFloat(amountUsdc),
        status: isPendingClaim ? "pending_claim" : "completed",
        note: memo,
        txHash,
        chain: plan.legs[0]?.chain,
      });

      // Notify recipient — fire-and-forget so a failed email never blocks the transfer
      sendTransferEmail(recipientEmail, amountUsdc, senderEmail, {
        isPendingClaim,
        note: memo || undefined,
      }).catch((err) =>
        console.error("[Transfer] Email notification failed:", err),
      );

      const isExisting = contacts.some(
        (c) => c.email.toLowerCase() === recipientEmail.toLowerCase(),
      );
      if (!isExisting) {
        setLastRecipient(recipientEmail);
        setShowSavePrompt(true);
      }

      queryClient.invalidateQueries({ queryKey: ["balance", smartAddress] });
      queryClient.invalidateQueries({ queryKey: ["history", senderEmail] });

      setAmount("");
      setRecipientEmail("");
      setMemo("");
      setIsPendingClaim(false);
      setSourcePref(AUTO_SOURCE);
    } catch (err) {
      console.error("[Transfer] Fatal Error:", err);
      toast.error(parseFriendlyError(err));
      setStatus("");
    }
    setLoading(false);
  };

  const isOverBalance = parseFloat(amountUsdc || "0") > parseFloat(balance);
  const isZeroBalance = parseFloat(balance) === 0;

  return {
    recipientEmail,
    setRecipientEmail,
    amount,
    setAmount,
    currency,
    setCurrency,
    memo,
    setMemo,
    sourcePref,
    setSourcePref,
    chainBalances: chainBalances ?? {},
    solanaBalance: solanaSource?.balance ?? 0,
    loading,
    status,
    setStatus,
    isPendingClaim,
    showSuggestions,
    setShowSuggestions,
    isAddingContact,
    setIsAddingContact,
    showSavePrompt,
    setShowSavePrompt,
    lastRecipient,
    lastCompletedTransfer,
    contacts,
    amountUsdc,
    isFiat,
    exchangeRate,
    isOverBalance,
    isZeroBalance,
    handleTransfer,
    recipientCheck,
    twoFaModalOpen,
    setTwoFaModalOpen,
    twoFaLoading,
    twoFaError,
    handleTwoFaSubmit,
    handleTwoFaResend,
    totpEnabled,
    passkeyEnabled,
    warningModalOpen,
    setWarningModalOpen,
    handleWarningConfirm,
    handleTwoFaClose,
  };
}
