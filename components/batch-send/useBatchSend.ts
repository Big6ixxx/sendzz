"use client";

import { batchSend, type SendResult } from "@/lib/batch-send";
import { type ChainBalances, type SolanaSource } from "@/lib/web3/routing";
import { type FiatCurrencyCode } from "@/lib/currency-config";
import { ConnectedWallet } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePinAuthorization } from "@/components/security/PinAuthorizationProvider";
import { noteTransactionAuthorization } from "@/lib/actions/transactionAuth";
import { describeBatch } from "@/lib/signing/describe";
import { selectConsolidationSources } from "@/lib/web3/bridge-actions";
import { toast } from "sonner";
import { useExchangeRate } from "@/lib/hooks/useExchangeRate";

import { parseAppError, isUserCancelled } from "@/lib/errors/appErrors";

export type Step =
  | "recipients"
  | "amount"
  | "preview"
  | "confirm"
  | "processing"
  | "results";

export interface Recipient {
  id: string;
  email: string;
  valid: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useBatchSend(
  maxAmount: number,
  smartAddress: string,
  senderEmail: string,
  embeddedProvider?: ConnectedWallet,
  twoFaThreshold: number = 500,
  chainBalances?: ChainBalances,
  solanaSource?: SolanaSource,
) {
  const queryClient = useQueryClient();
  const { authorize } = usePinAuthorization();
  const [step, setStep] = useState<Step>("recipients");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | FiatCurrencyCode>("USD");
  const [note, setNote] = useState("");

  const isFiat = currency !== "USD";
  const { data: exchangeRate = 1 } = useExchangeRate(isFiat ? currency : "USD");

  const [batchResults, setBatchResults] = useState<SendResult[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  // 2FA state
  const [twoFaModalOpen, setTwoFaModalOpen] = useState(false);
  const [twoFaOtpId, setTwoFaOtpId] = useState<string | null>(null);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);

  // Derived
  const validRecipients = recipients.filter((r) => r.valid);
  const amountUsd = isFiat
    ? parseFloat(amount || "0") / exchangeRate
    : parseFloat(amount || "0");
  const totalAmount = amountUsd * validRecipients.length;

  const handleConfirm = async (retryEmails?: string[]) => {
    if (!embeddedProvider) {
      toast.error("Wallet not connected");
      return;
    }
    if (totalAmount > maxAmount) {
      toast.error("Insufficient Balance");
      return;
    }

    // No KYC limit check — see the note in useCryptoTransfer. Limits live on the fiat edges.

    // Check if 2FA is required
    if (totalAmount >= twoFaThreshold) {
      // Always open 2FA modal for amounts >= threshold
      // If 2FA is not enabled, only email OTP will be available
      setTwoFaModalOpen(true);
      return;
    }

    await authorizeAndSend(retryEmails);
  };

  /**
   * Take the PIN for a batch, then send.
   *
   * The token is bound to the recipient count and the total rather than to one address,
   * because that is what a batch IS — and because those two numbers are what the user was
   * shown. A retry of the failed half re-authorises rather than reusing the first token: the
   * second send has a different set of recipients, so it is a different transaction.
   */
  const authorizeAndSend = async (retryEmails?: string[]) => {
    const targets = retryEmails || validRecipients.map((r) => r.email);
    const total = amountUsd * targets.length;

    const authorization = await authorize({
      purpose: "batch_send",
      payload: {
        // Sorted so the same set of people always produces the same hash, whatever order the
        // list was typed or retried in.
        destination: [...targets].map((e) => e.toLowerCase()).sort().join(","),
        amount: total,
      },
      title: `Send $${total.toFixed(2)} to ${targets.length} ${targets.length === 1 ? "person" : "people"}`,
      description:
        "Enter your PIN to approve this batch. Each person is paid separately, and payments " +
        "that succeed cannot be reversed.",
      details: [
        { label: "Each receives", value: `$${amountUsd.toFixed(2)}` },
        { label: "Recipients", value: String(targets.length) },
        { label: "Total", value: `$${total.toFixed(2)}` },
        ...(note ? [{ label: "Note", value: note }] : []),
      ],
      plan: describeBatch({
        recipientCount: targets.length,
        total,
        gatherFrom: selectConsolidationSources({
          targetChain: "base",
          requiredAmount: total.toFixed(6),
          balances: chainBalances ?? {},
          solanaBalance: solanaSource?.balance,
        }).map((source) => source.chain as string),
      }),
      confirmLabel: "Send batch",
    });

    if (!authorization) return;

    void noteTransactionAuthorization({
      token: authorization,
      purpose: "batch_send",
      payload: {
        destination: [...targets].map((e) => e.toLowerCase()).sort().join(","),
        amount: total,
      },
    }).catch(() => undefined);

    await executeBatchSendActual(retryEmails);
  };

  const executeBatchSendActual = async (retryEmails?: string[]) => {
    const targetEmails = retryEmails || validRecipients.map((r) => r.email);
    setStep("processing");
    setProgress({ done: 0, total: targetEmails.length });

    try {
      if (!embeddedProvider) {
        toast.error("Wallet not connected");
        setStep("confirm");
        return;
      }
      const provider = await embeddedProvider.getEthereumProvider();

      const results = await batchSend({
        recipients: targetEmails,
        amount: amountUsd.toString(),
        senderEmail,
        note: note || undefined,
        provider,
        chainBalances,
        wallet: embeddedProvider,
        smartAddress,
        solanaSource,
        onStatus: (s) => toast.loading(s, { id: "batch-consolidate" }),
        onProgress: (done, total) => setProgress({ done, total }),
      });
      toast.dismiss("batch-consolidate");

      if (retryEmails) {
        setBatchResults((prev) => {
          const updated = [...prev];
          results.forEach((newRes) => {
            const idx = updated.findIndex((r) => r.email === newRes.email);
            if (idx !== -1) updated[idx] = newRes;
            else updated.push(newRes);
          });
          return updated;
        });
      } else {
        setBatchResults(results);
      }

      setStep("results");
      queryClient.invalidateQueries({ queryKey: ["balance", smartAddress] });
      queryClient.invalidateQueries({ queryKey: ["history", senderEmail] });

      if (results.some((r) => r.status === "failed")) {
        toast.error("Some transfers failed. Review and retry.");
      } else {
        toast.success("All transfers completed successfully! 🎉");
      }
    } catch (err) {
      if (!isUserCancelled(err)) {
        toast.error(parseAppError(err));
      }
      setStep("confirm");
    }
  };

  const handleTwoFaSubmit = async (
    code: string,
    method?: "email" | "totp" | "passkey" | "pin",
  ) => {
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      let res;

      if (method === "passkey") {
        // Passkey is already verified in the modal, just proceed with the actual transfer
        // Execute the batch send without closing the modal
        await authorizeAndSend();
        // Only close modal after execution completes
        setTwoFaModalOpen(false);
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
      await authorizeAndSend();
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
      const res = await fetch("/api/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail: senderEmail,
          actionType: "transfer",
          payload: { amount: totalAmount, recipientEmail: "batch", note },
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

  const addRecipients = (emails: string[]) => {
    setRecipients((prev) => {
      const seen = new Set(prev.map((r) => r.email));
      const next = [...prev];
      for (const email of emails) {
        const trimmed = email.trim().toLowerCase();
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        next.push({
          id: `${Date.now()}-${Math.random()}`,
          email: trimmed,
          valid: EMAIL_RE.test(trimmed),
        });
      }
      return next;
    });
  };

  const removeRecipient = (id: string) => {
    setRecipients((p) => p.filter((r) => r.id !== id));
  };

  const reset = () => {
    setStep("recipients");
    setRecipients([]);
    setAmount("");
    setCurrency("USD");
    setNote("");
    setBatchResults([]);
    setProgress({ done: 0, total: 0 });
    setTwoFaModalOpen(false);
    setTwoFaOtpId(null);
    setTwoFaLoading(false);
    setTwoFaError(null);
  };

  return {
    step,
    setStep,
    recipients,
    setRecipients,
    addRecipients,
    removeRecipient,
    validRecipients,
    amount,
    setAmount,
    currency,
    setCurrency,
    note,
    setNote,
    amountUsd,
    totalAmount,
    batchResults,
    progress,
    handleConfirm,
    senderEmail,
    twoFaModalOpen,
    setTwoFaModalOpen,
    twoFaOtpId,
    twoFaLoading,
    twoFaError,
    handleTwoFaSubmit,
    handleTwoFaResend,
    reset,
  };
}
