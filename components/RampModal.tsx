"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Loader2,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Landmark,
  Copy,
  CheckCircle2,
  ChevronDown,
  Search,
  Wallet,
} from "lucide-react";
import {
  initiateOnRamp,
  getOffRampQuote,
  finalizeOffRamp,
  verifyBankAccount,
  getInstitutions,
  getOnRampRate,
  getOrderStatus,
} from "@/lib/actions/ramp";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { useWallets } from "@privy-io/react-auth";
import { toast } from "sonner";
import {
  PaycrestOrderResponse,
  PaycrestInstitution,
} from "@/lib/paycrest/types";
import { useQueryClient } from "@tanstack/react-query";

interface RampModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userAddress: string;
  type: "onramp" | "offramp";
  balance: string;
  userEmail: string;
}

export function RampModal({
  isOpen,
  onClose,
  userId,
  userAddress,
  type,
  balance,
  userEmail,
}: RampModalProps) {
  console.log("[RampModal] Rendering, isOpen:", isOpen);
  const { wallets } = useWallets();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [step, setStep] = useState(1);

  const [order, setOrder] = useState<PaycrestOrderResponse | null>(null);
  const [quote, setQuote] = useState<{
    rate: number;
    payoutAmount: number;
  } | null>(null);

  const [bankDetails, setBankDetails] = useState({
    accountNumber: "",
    bankCode: "",
    accountName: "",
    bankName: "",
  });
  const [institutions, setInstitutions] = useState<PaycrestInstitution[]>([]);
  const [bankSearch, setBankSearch] = useState("");
  const [showBankDropdown, setShowBankDropdown] = useState(false);

  const [error, setError] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const lastAttemptedRef = useRef<string>(""); // tracks bankCode-accountNumber

  // Countdown timer for onramp order validity
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Onramp polling state
  const [polling, setPolling] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!order?.providerAccount?.validUntil) return;
    const target = new Date(order.providerAccount.validUntil).getTime();
    const tick = () => {
      const diff = Math.max(0, Math.floor((target - Date.now()) / 1000));
      setSecondsLeft(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [order?.providerAccount?.validUntil]);

  // Persist order to localStorage so user can resume from /tx/[orderId]
  useEffect(() => {
    if (order?.id) {
      localStorage.setItem(
        "sendzz_pending_order",
        JSON.stringify({
          orderId: order.id,
          type,
          amount,
          createdAt: order.createdAt || new Date().toISOString(),
        }),
      );
    }
  }, [order?.id, type, amount, order?.createdAt]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const startPolling = () => {
    if (!order?.id) return;
    setPolling(true);
    setTxStatus("pending");

    const poll = async () => {
      try {
        const result = await getOrderStatus(order.id);
        const status = result.status;
        setTxStatus(status);

        const terminal = ["settled", "refunded", "expired"];
        if (terminal.includes(status)) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setPolling(false);
          if (status === "settled") {
            toast.success("Deposit confirmed! USDC credited to your wallet.");
            queryClient.invalidateQueries({ queryKey: ["balance", userAddress] });
            setStep(3);
          } else if (status === "refunded") {
            toast.error("Order refunded. Your NGN has been returned.");
          } else {
            toast.error("Order expired. Please start a new one.");
          }
        }
      } catch {
        // keep polling, network blip
      }
    };

    poll(); // immediate first check
    pollIntervalRef.current = setInterval(poll, 8000); // every 8s
  };

  // Onramp-specific state
  const [onRampRate, setOnRampRate] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [useCustomAddress, setUseCustomAddress] = useState(false);
  const [customAddress, setCustomAddress] = useState("");
  // Refund bank for onramp (required by Paycrest)
  const [refundBank, setRefundBank] = useState({
    accountNumber: "",
    bankCode: "",
    accountName: "",
    bankName: "",
  });
  const [refundBankSearch, setRefundBankSearch] = useState("");
  const [showRefundDropdown, setShowRefundDropdown] = useState(false);
  const [refundVerifying, setRefundVerifying] = useState(false);
  const [refundVerificationError, setRefundVerificationError] = useState("");
  const lastRefundAttemptRef = useRef<string>("");

  // Computed: estimated USDC received from NGN input
  const estimatedUsdc =
    onRampRate && amount ? (parseFloat(amount) / onRampRate).toFixed(4) : null;

  const filteredRefundInstitutions = useMemo(() => {
    if (!refundBankSearch) return institutions;
    return institutions.filter((i) =>
      i.name.toLowerCase().includes(refundBankSearch.toLowerCase()),
    );
  }, [institutions, refundBankSearch]);

  useEffect(() => {
    if (isOpen && (type === "offramp" || type === "onramp")) {
      const fetchBanks = async () => {
        try {
          const res = await getInstitutions("NGN");
          console.log("[RampModal] Institutions fetched:", res.data);
          setInstitutions(res.data);
        } catch (err) {
          console.error("Failed to fetch institutions:", err);
        }
      };
      fetchBanks();
    }
    if (isOpen && type === "onramp") {
      setRateLoading(true);
      getOnRampRate()
        .then((r) => setOnRampRate(r))
        .catch(() => setOnRampRate(null))
        .finally(() => setRateLoading(false));
    }
  }, [isOpen, type]);

  // Auto-verify refund bank account for onramp
  useEffect(() => {
    const { accountNumber, bankCode, accountName } = refundBank;
    const key = `${bankCode}-${accountNumber}`;
    if (
      accountNumber.length === 10 &&
      bankCode &&
      !accountName &&
      !refundVerifying &&
      lastRefundAttemptRef.current !== key
    ) {
      lastRefundAttemptRef.current = key;
      setRefundVerifying(true);
      setRefundVerificationError("");
      verifyBankAccount(bankCode, accountNumber)
        .then((res) => {
          const name =
            typeof res.data === "string"
              ? res.data
              : (res as unknown as { data: { accountName: string } }).data
                  ?.accountName;
          setRefundBank((prev) => ({ ...prev, accountName: name }));
          toast.success("Refund bank verified");
        })
        .catch((err) => {
          setRefundVerificationError(
            (err as Error)?.message || "Could not verify",
          );
        })
        .finally(() => setRefundVerifying(false));
    }
  }, [refundBank, refundVerifying]);

  const filteredInstitutions = useMemo(() => {
    if (!bankSearch) return institutions;
    return institutions.filter((inst) =>
      inst.name.toLowerCase().includes(bankSearch.toLowerCase()),
    );
  }, [institutions, bankSearch]);

  const handleOnRamp = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipient = useCustomAddress ? customAddress : userAddress;
    if (useCustomAddress && !customAddress.startsWith("0x")) {
      setError("Invalid wallet address. Must start with 0x.");
      return;
    }
    if (!refundBank.accountName) {
      setError("Please verify your refund bank account first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await initiateOnRamp(
        parseFloat(amount),
        userId,
        recipient,
        userEmail,
        {
          institution: refundBank.bankCode,
          accountIdentifier: refundBank.accountNumber,
          accountName: refundBank.accountName,
        },
      );
      setOrder(res);
      setStep(2);
    } catch (error) {
      const err = error as Error;
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGetOffRampQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parseFloat(amount) > parseFloat(balance)) {
      setError(`Insufficient Balance. Max available: ${balance} USDC`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await getOffRampQuote(parseFloat(amount));
      setQuote(res);
      setStep(2);
    } catch (error) {
      const err = error as Error;
      setError(err.message);
    }
    setLoading(false);
  };

  const handleVerifyAccount = useCallback(async () => {
    const attemptKey = `${bankDetails.bankCode}-${bankDetails.accountNumber}`;
    if (bankDetails.accountNumber.length !== 10 || !bankDetails.bankCode) {
      console.log(
        "[RampModal] Skipping verification: invalid inputs",
        bankDetails,
      );
      return;
    }

    console.log("[RampModal] Starting account verification:", attemptKey);
    setVerifying(true);
    setVerificationError("");
    lastAttemptedRef.current = attemptKey;

    try {
      const res = await verifyBankAccount(
        bankDetails.bankCode,
        bankDetails.accountNumber,
      );
      console.log("[RampModal] Verification success:", res);
      // The API returns the name directly in res.data
      const name =
        typeof res.data === "string"
          ? res.data
          : (res as unknown as { data: { accountName: string } }).data
              ?.accountName;
      setBankDetails((prev) => ({ ...prev, accountName: name }));
      toast.success("Account verified");
    } catch (error: unknown) {
      console.error("[RampModal] Verification error:", error);
      const err = error as Error;
      setVerificationError(err?.message || "Could not verify account");
      toast.error("Could not verify account");
    } finally {
      setVerifying(false);
    }
  }, [bankDetails]);

  useEffect(() => {
    const { accountNumber, bankCode, accountName } = bankDetails;
    const attemptKey = `${bankCode}-${accountNumber}`;

    console.log("[RampModal] Auto-verification check:", {
      accountNumberLength: accountNumber.length,
      bankCode,
      hasAccountName: !!accountName,
      verifying,
      lastAttempt: lastAttemptedRef.current,
      attemptKey,
    });

    if (
      accountNumber.length === 10 &&
      bankCode &&
      !accountName &&
      !verifying &&
      lastAttemptedRef.current !== attemptKey
    ) {
      console.log("[RampModal] TRIGGERING VERIFICATION!");
      handleVerifyAccount();
    }
  }, [bankDetails, verifying, handleVerifyAccount]);

  if (!isOpen) return null;

  const handleFinalizeOffRamp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankDetails.accountName) {
      setError("Please verify account first");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await finalizeOffRamp(
        parseFloat(amount),
        bankDetails.accountNumber,
        bankDetails.bankCode,
        bankDetails.accountName,
        userAddress,
        userEmail,
      );
      setOrder(res);
      setStep(3);
    } catch (error) {
      const err = error as Error;
      setError(err.message);
    }
    setLoading(false);
  };

  const handleExecuteTransfer = async () => {
    if (!order?.providerAccount?.receiveAddress) return;

    setTransferring(true);
    setError("");

    try {
      const embeddedWallet = wallets.find(
        (w) => w.walletClientType === "privy",
      );
      if (!embeddedWallet) throw new Error("Embedded wallet not found");

      const provider = await embeddedWallet.getEthereumProvider();

      toast.info("Initiating transfer...");
      const txHash = await executeCircleGaslessTransfer(
        provider,
        order?.providerAccount?.receiveAddress,
        amount,
      );

      toast.success(`Transfer Complete! Tx: ${txHash}`);
      
      // Refresh balance
      queryClient.invalidateQueries({ queryKey: ["balance", userAddress] });
      
      setTimeout(() => {
        onClose();
        setStep(1);
        setOrder(null);
        setAmount("");
      }, 2000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("[RampModal] Transfer failed:", err);
      setError(err?.message || "Failed to execute transfer");
    } finally {
      setTransferring(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="brutal-card w-full max-w-md bg-white text-black p-6 md:p-8 relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 hover:rotate-90 transition-transform"
        >
          <X className="w-8 h-8" />
        </button>

        <div className="mb-8 border-b-4 border-black pb-4">
          <h2 className="font-oswald text-3xl uppercase font-black flex items-center gap-3">
            {type === "onramp" ? (
              <ArrowDownLeft className="text-neon bg-black p-1" />
            ) : (
              <ArrowUpRight className="text-black bg-neon p-1" />
            )}
            {type === "onramp" ? "Deposit Capital" : "Withdraw Capital"}
          </h2>
          <p className="font-mono text-xs uppercase font-bold mt-2">
            Network: Base
          </p>
        </div>

        {error && (
          <div className="bg-red-500 text-white p-4 mb-6 font-mono text-sm border-2 border-black uppercase font-bold text-center">
            !! ERROR: {error}
          </div>
        )}

        {type === "onramp" ? (
          <div className="flex flex-col gap-6">
            {step === 1 && (
              <form onSubmit={handleOnRamp} className="flex flex-col gap-5">
                {/* Amount Input */}
                <div>
                  <label className="font-mono text-sm font-bold uppercase block mb-2 text-gray-600">
                    Amount (NGN)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="brutal-input text-2xl font-black"
                    placeholder="5000.00"
                    required
                    min="100"
                  />
                </div>

                {/* Live Rate & Estimate */}
                <div className="bg-black text-white p-4 border-2 border-black font-mono text-sm">
                  {rateLoading ? (
                    <div className="flex items-center gap-2 text-neon">
                      <Loader2 className="w-4 h-4 animate-spin" /> Fetching live
                      rate...
                    </div>
                  ) : onRampRate ? (
                    <>
                      <div className="flex justify-between border-b border-white/10 pb-2 mb-2">
                        <span className="opacity-60">RATE:</span>
                        <span className="font-bold text-neon">
                          1 USDC = {onRampRate.toLocaleString()} NGN
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-white/10 pb-2 mb-2">
                        <span className="opacity-60">YOU RECEIVE (EST.):</span>
                        <span className="font-bold text-neon">
                          {estimatedUsdc ?? "—"} USDC
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-60">PAYCREST FEE:</span>
                        <span className="font-bold text-green-400">
                          FREE (0%)
                        </span>
                      </div>
                    </>
                  ) : (
                    <span className="opacity-60">Rate unavailable</span>
                  )}
                </div>

                {/* Wallet Destination Selector */}
                <div>
                  <label className="font-mono text-xs font-bold uppercase block mb-2 text-gray-500">
                    Receive USDC To
                  </label>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => setUseCustomAddress(false)}
                      className={`flex-1 p-2 border-2 border-black font-mono text-xs font-black uppercase flex items-center justify-center gap-1 transition-colors ${
                        !useCustomAddress
                          ? "bg-neon text-black"
                          : "bg-white text-black hover:bg-gray-100"
                      }`}
                    >
                      <Wallet className="w-3 h-3" /> My Wallet
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseCustomAddress(true)}
                      className={`flex-1 p-2 border-2 border-black font-mono text-xs font-black uppercase flex items-center justify-center gap-1 transition-colors ${
                        useCustomAddress
                          ? "bg-neon text-black"
                          : "bg-white text-black hover:bg-gray-100"
                      }`}
                    >
                      <Copy className="w-3 h-3" /> Custom Address
                    </button>
                  </div>

                  {!useCustomAddress ? (
                    <div className="bg-gray-100 border-2 border-black p-3 font-mono text-xs text-black truncate">
                      <span className="opacity-50 block text-[10px] mb-1">
                        DESTINATION:
                      </span>
                      <span className="font-bold">
                        {userAddress || "Loading..."}
                      </span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={customAddress}
                      onChange={(e) => setCustomAddress(e.target.value)}
                      className="brutal-input font-mono text-xs"
                      placeholder="0x..."
                      required={useCustomAddress}
                    />
                  )}
                </div>

                {/* Refund Bank Account (required by Paycrest) */}
                <div>
                  <label className="font-mono text-xs font-bold uppercase block mb-1 text-gray-500">
                    Refund Bank Account <span className="text-red-500">*</span>
                  </label>
                  <p className="font-mono text-[10px] text-gray-400 mb-2">
                    If the order fails, Paycrest refunds your NGN here.
                  </p>

                  {/* Refund Bank Dropdown */}
                  <div className="relative mb-2">
                    <button
                      type="button"
                      onClick={() => setShowRefundDropdown(!showRefundDropdown)}
                      className="brutal-input w-full p-3 text-left flex justify-between items-center bg-white! text-black! border-4 border-black hover:bg-neon/10 transition-colors"
                    >
                      <div className="flex items-center gap-2 overflow-hidden mr-2">
                        {refundBank.bankCode && (
                          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        )}
                        <span
                          className={`truncate uppercase text-xs font-black ${refundBank.bankName ? "" : "text-gray-400"}`}
                        >
                          {refundBank.bankName || "SELECT REFUND BANK"}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-5 h-5 shrink-0 transition-transform ${showRefundDropdown ? "rotate-180" : ""}`}
                      />
                    </button>

                    {showRefundDropdown && (
                      <div className="absolute top-full left-0 right-0 z-100 bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mt-1 max-h-52 overflow-y-auto">
                        <div className="sticky top-0 bg-black p-2 z-10">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon" />
                            <input
                              type="text"
                              value={refundBankSearch}
                              onChange={(e) =>
                                setRefundBankSearch(e.target.value)
                              }
                              placeholder="SEARCH BANK..."
                              className="w-full pl-10 pr-3 py-2 text-xs font-black bg-white text-black border-2 border-black focus:outline-none"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        {filteredRefundInstitutions.map((inst) => (
                          <button
                            key={inst.code}
                            type="button"
                            onClick={() => {
                              const code = inst.institutionCode || inst.code;
                              setRefundBank({
                                accountNumber: "",
                                bankCode: code,
                                bankName: inst.name,
                                accountName: "",
                              });
                              setShowRefundDropdown(false);
                              setRefundBankSearch("");
                            }}
                            className="w-full text-left p-3 text-xs font-black font-mono hover:bg-neon text-black border-b border-black/10 last:border-0 uppercase"
                          >
                            {inst.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Refund Account Number */}
                  <div className="relative">
                    <input
                      type="text"
                      value={refundBank.accountNumber}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        setRefundBank({
                          ...refundBank,
                          accountNumber: val,
                          accountName: "",
                        });
                      }}
                      className="brutal-input p-3 w-full font-black text-black! bg-white! border-4 border-black placeholder:text-gray-300"
                      placeholder="0123456789"
                      maxLength={10}
                      disabled={!refundBank.bankCode}
                    />
                    {refundVerifying && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-5 h-5 animate-spin text-black" />
                      </div>
                    )}
                  </div>

                  {refundVerificationError && (
                    <div className="mt-1 bg-red-100 border-2 border-red-500 p-2 text-red-600 text-[10px] font-black uppercase">
                      !! {refundVerificationError}
                    </div>
                  )}

                  {refundBank.accountName && (
                    <div className="mt-2 bg-neon p-3 border-2 border-black flex items-center gap-2 text-black">
                      <CheckCircle2 className="w-4 h-4 text-green-700 shrink-0" />
                      <div>
                        <span className="text-[10px] opacity-70 block">
                          REFUND GOES TO:
                        </span>
                        <span className="font-black text-sm">
                          {refundBank.accountName}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || !amount || !refundBank.accountName}
                  className="brutal-btn flex items-center justify-center gap-4 w-full"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "GENERATE DEPOSIT ACCOUNT"
                  )}
                </button>
              </form>
            )}

            {step === 2 && order && (
              <div className="flex flex-col gap-6">
                {/* Countdown Timer */}
                {secondsLeft !== null && (
                  <div
                    className={`border-4 p-4 font-mono text-center ${
                      secondsLeft <= 60
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-black bg-black text-white"
                    }`}
                  >
                    <p className="text-[10px] uppercase font-bold opacity-70 mb-1">
                      Order Expires In
                    </p>
                    <p className="text-3xl font-black tracking-widest">
                      {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                      {String(secondsLeft % 60).padStart(2, "0")}
                    </p>
                    {secondsLeft === 0 && (
                      <p className="text-xs mt-1 font-bold uppercase">
                        Order expired. Please start a new one.
                      </p>
                    )}
                  </div>
                )}

                <div className="bg-neon/10 border-4 border-black p-6 font-mono">
                  <p className="text-xs uppercase font-bold mb-4 border-b-2 border-black pb-2">
                    Transfer exactly this amount:
                  </p>
                  <div className="text-3xl font-black mb-4">
                    {order.providerAccount?.amountToTransfer}{" "}
                    {order.providerAccount?.currency}
                  </div>

                  <div className="space-y-4 text-sm">
                    <div
                      className="flex justify-between items-center group cursor-pointer"
                      onClick={() =>
                        copyToClipboard(
                          order.providerAccount?.accountIdentifier || "",
                          "Account Number",
                        )
                      }
                    >
                      <span className="opacity-60">ACCOUNT:</span>
                      <span className="font-bold flex items-center gap-2">
                        {order.providerAccount?.accountIdentifier}{" "}
                        <Copy className="w-3 h-3" />
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="opacity-60">BANK:</span>
                      <span className="font-bold">
                        {order.providerAccount?.institution}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="opacity-60">NAME:</span>
                      <span className="font-bold text-xs text-right">
                        {order.providerAccount?.accountName}
                      </span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] font-mono leading-tight opacity-70">
                  * Funds will be automatically credited to your smart account
                  once the transfer is confirmed on-chain.
                </p>
                {polling ? (
                  <div className="border-4 border-black p-4 font-mono text-center bg-black text-white">
                    <div className="flex items-center justify-center gap-3 mb-2">
                      <Loader2 className="w-5 h-5 animate-spin text-neon" />
                      <span className="text-sm font-black uppercase text-neon">
                        Checking Payment...
                      </span>
                    </div>
                    <p className="text-[10px] opacity-60 uppercase">
                      Status:{" "}
                      <span className="text-neon font-black">
                        {txStatus?.toUpperCase() ?? "PENDING"}
                      </span>
                    </p>
                    <p className="text-[10px] opacity-50 mt-1">
                      Order ID: <span className="font-mono">{order.id}</span>
                    </p>
                    <a
                      href={`/tx/${order.id}`}
                      className="block mt-3 text-[10px] underline text-neon opacity-70 hover:opacity-100"
                      target="_blank"
                    >
                      View in dedicated page →
                    </a>
                  </div>
                ) : (
                  <button onClick={startPolling} className="brutal-btn w-full">
                    I HAVE TRANSFERRED
                  </button>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col items-center gap-6 py-4 text-center">
                <div className="bg-neon border-4 border-black w-20 h-20 flex items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-black" />
                </div>
                <div>
                  <h3 className="font-oswald text-2xl font-black uppercase mb-2">
                    Deposit Confirmed!
                  </h3>
                  <p className="font-mono text-sm text-gray-600">
                    Your USDC has been credited to your smart account.
                  </p>
                </div>
                <button
                  onClick={() => {
                    onClose();
                    setStep(1);
                    setOrder(null);
                    setAmount("");
                    setTxStatus(null);
                  }}
                  className="brutal-btn w-full bg-neon! text-black!"
                >
                  DONE
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {step === 1 && (
              <form
                onSubmit={handleGetOffRampQuote}
                className="flex flex-col gap-6"
              >
                <div>
                  <label className="font-mono text-sm font-bold uppercase block mb-2 text-gray-600">
                    Amount (USDC)
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="brutal-input text-2xl font-black"
                    placeholder="10.00"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="brutal-btn flex items-center justify-center gap-4 w-full"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "CHECK EXCHANGE RATE"
                  )}
                </button>
              </form>
            )}

            {step === 2 && quote && (
              <form
                onSubmit={handleFinalizeOffRamp}
                className="flex flex-col gap-6 font-mono"
              >
                <div className="bg-black text-white p-4 border-2 border-black text-sm">
                  <div className="flex justify-between border-b border-white/10 pb-1 mb-1">
                    <span>RATE:</span>
                    <span className="font-bold text-neon">
                      1 USDC = {quote.rate} NGN
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>ESTIMATED RECEIVE:</span>
                    <span className="font-bold text-neon">
                      {quote.payoutAmount.toLocaleString()} NGN
                    </span>
                  </div>
                </div>

                <div className="relative">
                  <label className="font-mono text-[10px] font-black uppercase block mb-1 text-black bg-neon dark:bg-black dark:text-neon w-fit px-1 border-2 border-black">
                    Destination Bank
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowBankDropdown(!showBankDropdown)}
                    className="brutal-input w-full p-3 text-left flex justify-between items-center bg-white! text-black! border-4 border-black group hover:bg-neon/10 transition-colors"
                  >
                    <div className="flex items-center gap-2 overflow-hidden mr-2">
                      {bankDetails.bankCode && (
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                      )}
                      <span
                        className={`truncate uppercase ${bankDetails.bankName ? "font-black" : "text-gray-400"}`}
                      >
                        {bankDetails.bankName || "SEARCH & SELECT BANK"}
                      </span>
                    </div>
                    <ChevronDown
                      className={`w-5 h-5 shrink-0 transition-transform ${showBankDropdown ? "rotate-180" : ""}`}
                    />
                  </button>

                  {showBankDropdown && (
                    <div className="absolute top-full left-0 right-0 z-100 bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mt-2 max-h-64 overflow-y-auto">
                      <div className="sticky top-0 bg-black p-3 border-b-4 border-black z-10">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon" />
                          <input
                            type="text"
                            value={bankSearch}
                            onChange={(e) => setBankSearch(e.target.value)}
                            placeholder="TYPE BANK NAME..."
                            className="w-full pl-10 pr-3 py-2 text-xs font-black bg-white text-black border-2 border-black focus:outline-none focus:bg-white focus:ring-2 focus:ring-neon"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                      <div className="bg-white">
                        {filteredInstitutions.length > 0 ? (
                          filteredInstitutions.map((inst) => (
                            <button
                              key={`${inst.institutionCode}-${inst.code}`}
                              type="button"
                              onClick={() => {
                                const code = inst.institutionCode || inst.code;
                                console.log(
                                  "[RampModal] Selected bank:",
                                  inst.name,
                                  "Code:",
                                  code,
                                );
                                setBankDetails({
                                  ...bankDetails,
                                  bankCode: code,
                                  bankName: inst.name,
                                  accountName: "",
                                });
                                setShowBankDropdown(false);
                                setBankSearch("");
                              }}
                              className="w-full text-left p-3 text-xs font-black font-mono hover:bg-neon text-black border-b-2 border-black/10 last:border-0 uppercase"
                            >
                              {inst.name}
                            </button>
                          ))
                        ) : (
                          <div className="p-8 text-center font-mono text-xs text-gray-500 uppercase">
                            No banks match your search
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="font-mono text-[10px] font-black uppercase block mb-1 text-black bg-neon dark:bg-black dark:text-neon w-fit px-1 border-2 border-black">
                    Account Number
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={bankDetails.accountNumber}
                      autoComplete="off"
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        setBankDetails({
                          ...bankDetails,
                          accountNumber: val,
                          accountName: "",
                        });
                        setVerificationError("");
                      }}
                      className="brutal-input p-3 text-xl w-full font-black text-black! bg-white! border-4 border-black placeholder:text-gray-300 focus:bg-white! active:bg-white!"
                      required
                      maxLength={10}
                      placeholder="0123456789"
                    />
                    {verifying && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-6 h-6 animate-spin text-black" />
                      </div>
                    )}
                  </div>
                  {verificationError && (
                    <div className="mt-2 bg-red-100 border-2 border-red-500 p-2 text-red-600 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(239,68,68,1)] animate-in fade-in slide-in-from-top-1">
                      !! VERIFICATION FAILED: {verificationError}
                    </div>
                  )}
                </div>

                {bankDetails.accountName && (
                  <div className="bg-neon p-4 border-4 border-black text-sm flex items-center gap-3 text-black font-black uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-in fade-in slide-in-from-top-2">
                    <div className="bg-white rounded-full p-1 border-2 border-black">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] opacity-70">
                        CONFIRMED ACCOUNT HOLDER:
                      </span>
                      <span>{bankDetails.accountName}</span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !bankDetails.accountName}
                  className="brutal-btn mt-4 flex items-center justify-center gap-4 w-full bg-black! text-white!"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "FINALIZE WITHDRAWAL"
                  )}
                </button>
              </form>
            )}

            {step === 3 && order && (
              <div className="text-center py-4">
                <div className="bg-black text-neon p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
                  <Landmark className="w-10 h-10" />
                </div>
                <h3 className="font-oswald text-2xl font-black uppercase mb-4">
                  Transfer Required
                </h3>
                <div className="bg-neon/10 border-4 border-black p-4 mb-6 font-mono text-sm text-left">
                  <p className="mb-2 opacity-70 uppercase font-bold text-xs">
                    Send tokens to this address:
                  </p>
                  <div
                    className="flex items-center gap-2 bg-white border-2 border-black p-2 group cursor-pointer"
                    onClick={() =>
                      copyToClipboard(
                        order.providerAccount?.receiveAddress || "",
                        "Address",
                      )
                    }
                  >
                    <code className="text-[10px] break-all font-bold">
                      {order.providerAccount?.receiveAddress}
                    </code>
                    <Copy className="w-4 h-4 shrink-0" />
                  </div>
                  <div className="mt-4 flex justify-between">
                    <span className="text-xs">NETWORK:</span>
                    <span className="text-xs font-bold">BASE</span>
                  </div>
                </div>
                <p className="font-mono text-[10px] text-gray-600 mb-8 leading-tight">
                  By clicking below, the exact amount will be sent from your
                  Smart Account gaslessly.
                </p>
                <button
                  onClick={handleExecuteTransfer}
                  disabled={transferring}
                  className="brutal-btn w-full bg-neon! text-black!"
                >
                  {transferring ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      PROCESSING...
                    </div>
                  ) : (
                    "EXECUTE TRANSFER AUTOMATICALLY"
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
