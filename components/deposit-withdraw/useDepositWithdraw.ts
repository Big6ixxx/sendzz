"use client";

import {
  finalizeOffRamp,
  getInstitutions,
  getOffRampQuote,
  getOffRampRate,
  getOnRampRate,
  getOrderStatus,
  initiateOnRamp,
  verifyBankAccount,
} from "@/lib/actions/ramp";
import {
  updateDepositStatus,
  updateWithdrawalStatus,
  saveWithdrawalTxHash,
  saveDepositTxHash,
} from "@/lib/supabase/transactions";
import { type FiatCurrencyCode } from "@/lib/currency-config";
import {
  getUserBankContacts,
  addBankContact,
  type BankContactRow,
} from "@/lib/supabase/bank-contacts";
import {
  PaycrestInstitution,
  PaycrestOrderResponse,
} from "@/lib/paycrest/types";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { parseFriendlyError } from "@/components/transfer/useTransfer";
import { ConnectedWallet } from "@privy-io/react-auth";
import { calculatePaycrestBaseAmount } from "@/lib/paycrest/config";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCurrencies } from "@/lib/hooks/useCurrencies";

export type FlowType = "deposit" | "withdraw";

interface BankDetails {
  accountNumber: string;
  bankCode: string;
  accountName: string;
  bankName: string;
}

export function useDepositWithdraw(
  type: FlowType,
  userAddress: string,
  userEmail: string,
  userId: string,
  balance: string,
  embeddedProvider?: ConnectedWallet,
  onClose?: () => void,
) {
  const queryClient = useQueryClient();
  const { data: currencies } = useCurrencies();
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("");
  const [inputMode, setInputMode] = useState<"usdc" | "fiat">("usdc");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrencyCode>("NGN");

  // Sync fiatCurrency with available currencies if current one is not supported
  useEffect(() => {
    if (currencies && currencies.length > 0) {
      const isSupported = currencies.some((c) => c.code === fiatCurrency);
      if (!isSupported) {
        setFiatCurrency(currencies[0].code);
      }
    }
  }, [currencies, fiatCurrency]);

  // Institutions & Rates
  const [institutions, setInstitutions] = useState<PaycrestInstitution[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  // Bank Selection
  const [bankDetails, setBankDetails] = useState<BankDetails>({
    accountNumber: "",
    bankCode: "",
    accountName: "",
    bankName: "",
  });
  const [verifyingBank, setVerifyingBank] = useState(false);
  const lastAttemptedRef = useRef<string>("");

  // Order & Execution
  const [order, setOrder] = useState<PaycrestOrderResponse | null>(null);
  const [quote, setQuote] = useState<{
    rate: number;
    payoutAmount: number;
  } | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [bankContacts, setBankContacts] = useState<BankContactRow[]>([]);
  const [showSavePrompt, setShowSavePrompt] = useState(false);

  // Polling for deposit status
  const [polling, setPolling] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [withdrawalTxHash, setWithdrawalTxHash] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 2FA State
  const [twoFaModalOpen, setTwoFaModalOpen] = useState(false);
  const [twoFaOtpId, setTwoFaOtpId] = useState<string | null>(null);
  const [twoFaLoading, setTwoFaLoading] = useState(false);
  const [twoFaError, setTwoFaError] = useState<string | null>(null);

  // Fetch institutions & rates when fiatCurrency changes
  useEffect(() => {
    const init = async () => {
      try {
        const res = await getInstitutions(fiatCurrency);
        setInstitutions(res.data);
      } catch (err) {
        console.error("Failed to fetch banks", err);
      }
    };
    init();

    // Reset bank details when currency changes
    setBankDetails({
      accountNumber: "",
      bankCode: "",
      accountName: "",
      bankName: "",
    });
    lastAttemptedRef.current = "";
    setRate(null);

    setRateLoading(true);
    if (type === "deposit") {
      getOnRampRate(fiatCurrency)
        .then(setRate)
        .catch(() => setRate(null))
        .finally(() => setRateLoading(false));
    } else {
      getOffRampRate(fiatCurrency)
        .then(setRate)
        .catch(() => setRate(null))
        .finally(() => setRateLoading(false));
    }

    // Fetch bank contacts
    if (userEmail) {
      getUserBankContacts(userEmail).then(setBankContacts).catch(console.error);
    }
  }, [type, fiatCurrency, userEmail]);

  // Bank Auto-Verification
  const handleVerifyBank = useCallback(async (details: BankDetails) => {
    const key = `${details.bankCode}-${details.accountNumber}`;
    if (
      details.accountNumber.length !== 10 ||
      !details.bankCode ||
      lastAttemptedRef.current === key
    )
      return;

    setVerifyingBank(true);
    lastAttemptedRef.current = key;
    try {
      const res = await verifyBankAccount(
        details.bankCode,
        details.accountNumber,
      );
      const name =
        typeof res.data === "string" ? res.data : res.data?.accountName;
      setBankDetails((prev) => ({ ...prev, accountName: name }));
      toast.success("Bank account verified");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
      setBankDetails((prev) => ({ ...prev, accountName: "" }));
    } finally {
      setVerifyingBank(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (
        bankDetails.accountNumber.length === 10 &&
        bankDetails.bankCode &&
        !bankDetails.accountName
      ) {
        handleVerifyBank(bankDetails);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [bankDetails, handleVerifyBank]);

  // Flow Handlers
  const handleDepositInitiate = async () => {
    if (!bankDetails.accountName) {
      toast.error("Please verify your refund bank account");
      return;
    }

    const val = parseFloat(amount);
    if (isNaN(val) || val <= 0) {
      toast.error("Enter a valid amount");
      return;
    }

    // Minimums
    if (fiatCurrency === "NGN" && val < 1000) {
      toast.error("Minimum deposit is 1,000 NGN");
      return;
    }

    // Check estimated USDC > 1 (after fees)
    const baseAmount = calculatePaycrestBaseAmount(val);
    const estimatedUsdc = baseAmount / (rate || 1);
    if (estimatedUsdc <= 1) {
      toast.error("Estimated deposit must be greater than 1 USDC");
      return;
    }

    setLoading(true);
    try {
      const res = await initiateOnRamp({
        amountFiat: val,
        userId,
        userAddress,
        userEmail,
        refundAccount: {
          institution: bankDetails.bankCode,
          accountIdentifier: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        },
        fiatCurrency,
      });
      setOrder(res);
      setStep(2);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "An unknown error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawQuote = async () => {
    let val = parseFloat(amount);

    if (inputMode === "fiat") {
      if (!rate) {
        toast.error("Exchange rate not available yet");
        return;
      }
      val = val / rate;
    }

    if (isNaN(val) || val < 1) {
      toast.error("Minimum withdrawal is 1 USDC");
      return;
    }

    if (val > parseFloat(balance)) {
      toast.error(`Insufficient balance. Max: ${balance} USDC`);
      return;
    }

    // Update state to USDC so finalization step uses correct amount
    if (inputMode === "fiat") {
      setAmount(val.toFixed(2));
      setInputMode("usdc");
    }

    setLoading(true);
    try {
      const res = await getOffRampQuote(val, fiatCurrency);
      setQuote(res);
      setStep(2);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "An unknown error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawFinalize = async () => {
    if (!bankDetails.accountName) {
      toast.error("Please verify destination account");
      return;
    }

    const amountUsdc = parseFloat(amount);
    if (amountUsdc >= 1) {
      // 2FA Required
      setLoading(true);
      try {
        const res = await fetch("/api/2fa/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userEmail,
            actionType: "withdrawal",
            payload: {
              amountUsdc,
              accountNumber: bankDetails.accountNumber,
              bankCode: bankDetails.bankCode,
              fiatCurrency,
              fiatAmount: quote?.payoutAmount,
            },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to initiate 2FA");

        setTwoFaOtpId(data.otp_id);
        setTwoFaModalOpen(true);
      } catch (err: unknown) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to initiate 2FA";
        toast.error(errorMessage);
      } finally {
        setLoading(false);
      }
      return;
    }

    await executeWithdrawalActual();
  };

  const handleTwoFaSubmit = async (code: string) => {
    if (!twoFaOtpId) return;
    setTwoFaLoading(true);
    setTwoFaError(null);
    try {
      const res = await fetch("/api/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          otp_id: twoFaOtpId,
          otp_code: code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");

      setTwoFaModalOpen(false);
      setTwoFaOtpId(null);
      await executeWithdrawalActual();
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
      const amountUsdc = parseFloat(amount);
      const res = await fetch("/api/2fa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userEmail,
          actionType: "withdrawal",
          payload: {
            amountUsdc,
            accountNumber: bankDetails.accountNumber,
            bankCode: bankDetails.bankCode,
            fiatCurrency,
            fiatAmount: quote?.payoutAmount,
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

  const executeWithdrawalActual = async () => {
    if (!bankDetails.accountName) {
      toast.error("Please verify destination account");
      return;
    }
    setLoading(true);
    try {
      const res = await finalizeOffRamp(
        parseFloat(amount),
        bankDetails.accountNumber,
        bankDetails.bankCode,
        bankDetails.accountName,
        userAddress,
        userEmail,
        fiatCurrency,
        quote?.payoutAmount,
        quote?.rate,
      );
      setOrder(res);
      setStep(3);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "An unknown error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  const executeTransfer = async () => {
    if (!order?.providerAccount?.receiveAddress || !embeddedProvider) return;
    setTransferring(true);
    try {
      const provider = await embeddedProvider.getEthereumProvider();
      const txHash = await executeCircleGaslessTransfer(
        provider,
        order.providerAccount.receiveAddress,
        amount,
      );
      setWithdrawalTxHash(txHash);
      if (order.id && txHash) {
        saveWithdrawalTxHash(order.id, txHash).catch(console.error);
      }
      toast.success("Transfer sent! Waiting for confirmation...");
      queryClient.invalidateQueries({ queryKey: ["balance", userAddress] });
      setStep(4);
      startPolling();
    } catch (err) {
      toast.error(parseFriendlyError(err));
    } finally {
      setTransferring(false);
    }
  };

  const startPolling = useCallback(() => {
    if (!order?.id) return;
    setPolling(true);
    const poll = async () => {
      try {
        const result = await getOrderStatus(order.id);
        setTxStatus(result.status);

        const isWithdraw = type === "withdraw";
        const successStatuses = isWithdraw
          ? ["settled", "completed", "validated", "deposited"]
          : ["settled"];
        const failureStatuses = ["refunded", "expired", "failed", "refunding"];

        const isSuccess = successStatuses.includes(result.status);
        const isFailure = failureStatuses.includes(result.status);

        if (isSuccess || isFailure) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setPolling(false);

          if (isSuccess) {
            if (isWithdraw) {
              updateWithdrawalStatus(order.id, "completed");
              toast.success("Withdrawal completed!");

              // Check if bank is already in contacts
              const exists = bankContacts.some(
                (c) => c.account_number === bankDetails.accountNumber,
              );
              if (!exists) {
                setShowSavePrompt(true);
              }

              queryClient.invalidateQueries({
                queryKey: ["balance", userAddress],
              });
              // Only close if not showing save prompt
              if (exists) {
                setTimeout(() => onClose?.(), 2000);
              }
            } else {
              updateDepositStatus(order.id, "confirmed");
              // Try to capture settlement tx hash from Paycrest order status
              const settlementTxHash =
                result.txHash ||
                result.settlementTxHash ||
                result.transactionHash;
              if (settlementTxHash && order.id) {
                saveDepositTxHash(order.id, settlementTxHash).catch(
                  console.error,
                );
              }
              toast.success("Funds received!");

              // Check if bank is already in contacts (for refund)
              const exists = bankContacts.some(
                (c) => c.account_number === bankDetails.accountNumber,
              );
              if (!exists) {
                setShowSavePrompt(true);
              }

              queryClient.invalidateQueries({
                queryKey: ["balance", userAddress],
              });
              setStep(3);
            }
          } else {
            if (isWithdraw) {
              updateWithdrawalStatus(order.id, "failed");
            } else {
              updateDepositStatus(order.id, "failed");
            }
            toast.error(`Transaction ${result.status}`);
          }
        }
      } catch {}
    };
    poll();
    pollIntervalRef.current = setInterval(poll, 8000);
  }, [order?.id, queryClient, userAddress, type, onClose]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const refreshBankContacts = useCallback(async () => {
    if (userEmail) {
      const contacts = await getUserBankContacts(userEmail).catch(() => []);
      setBankContacts(contacts);
    }
  }, [userEmail]);

  return {
    step,
    setStep,
    amount,
    setAmount,
    balance,
    inputMode,
    setInputMode,
    loading,
    error,
    fiatCurrency,
    setFiatCurrency,
    institutions,
    rate,
    rateLoading,
    bankDetails,
    setBankDetails,
    verifyingBank,
    order,
    quote,
    transferring,
    polling,
    txStatus,
    withdrawalTxHash,
    bankContacts,
    showSavePrompt,
    setShowSavePrompt,
    userEmail,
    userAddress,
    refreshBankContacts,
    handleDepositInitiate,
    handleWithdrawQuote,
    handleWithdrawFinalize,
    executeTransfer,
    startPolling,
    twoFaModalOpen,
    setTwoFaModalOpen,
    twoFaLoading,
    twoFaError,
    handleTwoFaSubmit,
    handleTwoFaResend,
    handleSaveBankContact: async () => {
      try {
        await addBankContact({
          userEmail,
          bankName: bankDetails.bankName,
          bankCode: bankDetails.bankCode,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        });
        toast.success("Bank account saved!");
        setShowSavePrompt(false);
        getUserBankContacts(userEmail)
          .then(setBankContacts)
          .catch(console.error);
        if (type === "withdraw") {
          setTimeout(() => onClose?.(), 1000);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save bank");
      }
    },
    reset: () => {
      setStep(1);
      setAmount("");
      setOrder(null);
      setQuote(null);
      setTxStatus(null);
      setPolling(false);
      setShowSavePrompt(false);
      setBankDetails({
        accountNumber: "",
        bankCode: "",
        accountName: "",
        bankName: "",
      });
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    },
    goBack: () => {
      setStep((prev) => (prev > 1 ? prev - 1 : 1));
    },
    onClose,
  };
}
