"use client";

import {
  executeOffRamp,
  getInstitutions,
  getOffRampProviderOrder,
  getOffRampQuote,
  getOffRampRate,
  getOnRampRate,
  getOrderStatus,
  getCorridorFeeAction,
  getProviderFeePercent,
  getRampNetworks,
  initiateOnRamp,
  verifyBankAccount,
} from "@/lib/actions/ramp";
import type { RampProviderName } from "@/lib/ramp";
import { CHAIN_NAMES, type SupportedChain } from "@/lib/circle/gateway";
import {
  updateDepositStatus,
  saveWithdrawalTxHash,
  saveDepositTxHash,
  reconcileOrderStatus,
} from "@/lib/supabase/transactions";
import { type FiatCurrencyCode } from "@/lib/currency-config";
import {
  getUserBankContacts,
  addBankContact,
  type BankContactRow,
} from "@/lib/supabase/bank-contacts";
import {
  RampInstitution,
  RampNetwork,
  RampOrderResponse,
} from "@/lib/ramp";
import {
  executeCircleGaslessTransfer,
  executeCircleGaslessBatchTransfer,
} from "@/lib/web3/circle-actions";
import { consolidateFundsToChain } from "@/lib/web3/bridge-actions";
import { bridgeStellarToBase } from "@/lib/web3/stellar-bridge";
import {
  planWithdrawalRoute,
  AUTO_SOURCE,
  RAMP_NETWORKS,
  type ChainBalances,
  type SolanaSource,
  type SourceChainKey,
  type SourcePreference,
} from "@/lib/web3/routing";
import { parseFriendlyError } from "@/components/transfer/useTransfer";
import { ConnectedWallet } from "@privy-io/react-auth";
import { calculatePaycrestBaseAmount } from "@/lib/paycrest/config";
import { totalFromBase } from "@/lib/ramp/fees";
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
  memo?: string;
}

export function useDepositWithdraw(
  type: FlowType,
  userAddress: string,
  userEmail: string,
  userId: string,
  balance: string,
  embeddedProvider?: ConnectedWallet,
  onClose?: () => void,
  chainBalances?: ChainBalances,
  solanaSource?: SolanaSource,
  stellarAddress?: string,
  stellarWalletId?: string,
  stellarBalance = 0,
) {
  const queryClient = useQueryClient();
  const { data: currencies } = useCurrencies();
  const [step, setStep] = useState(1);
  const [amount, setAmount] = useState("");
  const [inputMode, setInputMode] = useState<"usdc" | "fiat">("usdc");
  const [loading, setLoading] = useState(false);
  const [error] = useState<string | null>(null);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrencyCode>("NGN");
  const [quoteUsdcAmount, setQuoteUsdcAmount] = useState<string>("");
  // On-ramp landing chain. Defaults to Base; advanced users may pick another supported chain.
  const [depositNetwork, setDepositNetwork] = useState<RampNetwork>("base");

  // User Security Preferences
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [twoFaThreshold, setTwoFaThreshold] = useState(500);

  // Discover the off-ramp settlement networks from the active provider (once).
  useEffect(() => {
    getRampNetworks()
      .then((n) => setRampNetworks(n as SupportedChain[]))
      .catch(() => setRampNetworks(undefined));
  }, []);

  // Sync fiatCurrency with available currencies if current one is not supported
  useEffect(() => {
    if (currencies && currencies.length > 0) {
      const isSupported = currencies.some((c) => c.code === fiatCurrency);
      if (!isSupported) {
        setFiatCurrency(currencies[0].code);
      }
    }
  }, [currencies, fiatCurrency]);

  // Off-ramp provider pinned for this withdrawal (banks + verify + order all use it).
  const [offRampProvider, setOffRampProvider] = useState<RampProviderName | undefined>(
    undefined,
  );
  // Platform fee % for the pinned provider (drives the fee line + balance math). The actual
  // fee amount/treasury is resolved server-side and embedded in the order.
  const [feePercent, setFeePercent] = useState<number>(0);
  // Flat per-corridor provider fee in USDC, on top of base + platform fee. Bitnob only.
  const [corridorFee, setCorridorFee] = useState<number>(0);

  // Institutions & Rates
  const [institutions, setInstitutions] = useState<RampInstitution[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
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

  // Order & Execution
  const [order, setOrder] = useState<RampOrderResponse | null>(null);
  const [quote, setQuote] = useState<{
    rate: number;
    payoutAmount: number;
  } | null>(null);
  const [transferring, setTransferring] = useState(false);
  // Ramp-supported chain chosen by the router to source the off-ramp from.
  const [withdrawChain, setWithdrawChain] = useState<RampNetwork>("base");
  // Settlement networks the active off-ramp provider supports (fetched, not hardcoded).
  const [rampNetworks, setRampNetworks] = useState<SupportedChain[] | undefined>(
    undefined,
  );
  // When funds are split across chains, we auto-bridge them onto Base before withdrawing.
  const [mustConsolidate, setMustConsolidate] = useState(false);
  // User source override (default: smart auto). Set via the SourceSelector.
  const [sourcePref, setSourcePref] = useState<SourcePreference>(AUTO_SOURCE);
  // When consolidating, the specific chains to pull from (null = all funded).
  const [consolidateFrom, setConsolidateFrom] = useState<SourceChainKey[] | null>(null);
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
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyEnabled, setPasskeyEnabled] = useState(false);

  // Fetch institutions & rates when fiatCurrency changes
  useEffect(() => {
    const init = async () => {
      setInstitutionsLoading(true);
      try {
        let provider: RampProviderName;
        let instRes: { data: RampInstitution[] } = { data: [] };

        if (type === "withdraw") {
          const order = await getOffRampProviderOrder(fiatCurrency).catch(
            () => ["paycrest"] as RampProviderName[],
          );
          provider = order[0] || "paycrest";
          instRes = await getInstitutions(fiatCurrency).catch(() => ({ data: [] }));
        } else {
          provider = "paycrest";
          instRes = await getInstitutions(fiatCurrency, provider).catch(() => ({ data: [] }));
        }

        setOffRampProvider(provider);
        getProviderFeePercent(provider).then(setFeePercent).catch(() => setFeePercent(0));
        // Flat provider fee for this corridor (Bitnob only). Fetched alongside the provider so
        // it is known before the amount is validated, not after the order exists.
        getCorridorFeeAction(provider, fiatCurrency)
          .then(setCorridorFee)
          .catch(() => setCorridorFee(0));
        setInstitutions(instRes.data);
      } catch (err) {
        console.error("Failed to fetch banks", err);
      } finally {
        setInstitutionsLoading(false);
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

      if (quoteUsdcAmount) {
        const val = parseFloat(quoteUsdcAmount);
        if (!isNaN(val) && val > 0) {
          getOffRampQuote(val, fiatCurrency)
            .then(setQuote)
            .catch(() => {});
        }
      }
    }

    // Fetch bank contacts
    if (userEmail) {
      getUserBankContacts().then(setBankContacts).catch(console.error);

      // Fetch security preferences
      fetch(`/api/user/preferences?email=${encodeURIComponent(userEmail)}`)
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
  }, [type, fiatCurrency, userEmail]);

  // Dynamic bank code resolution for saved contacts across different providers
  const handleSelectContact = useCallback(
    (contact: {
      bankCode: string;
      bankName: string;
      accountNumber: string;
      accountName: string;
    }) => {
      const normalizeBankName = (s: string): string => {
        const normalized = (s || "")
          .toLowerCase()
          .replace(/\b(bank|plc|ltd|limited|nigeria|microfinance|mfb|company)\b/g, "")
          .replace(/[^a-z0-9]/g, "");

        // Map common abbreviations and aliases to a single canonical term
        if (
          normalized === "gtb" ||
          normalized === "gt" ||
          normalized === "gtbank" ||
          normalized === "guarantytrust" ||
          normalized === "guarantytrustbank"
        ) {
          return "gtb";
        }
        if (normalized === "uba" || normalized === "unitedbankforafrica") {
          return "uba";
        }
        if (normalized === "fcmb" || normalized === "firstcitymonument") {
          return "fcmb";
        }
        if (normalized === "first" || normalized === "firstbank" || normalized === "fbn") {
          return "firstbank";
        }
        if (normalized === "stanbic" || normalized === "stanbicibtc" || normalized === "ibtc") {
          return "stanbic";
        }
        if (normalized === "access" || normalized === "accessbank") {
          return "access";
        }
        if (normalized === "zenith" || normalized === "zenithbank") {
          return "zenith";
        }
        if (normalized === "sterling" || normalized === "sterlingbank") {
          return "sterling";
        }
        if (normalized === "wema" || normalized === "wemabank") {
          return "wema";
        }
        if (normalized === "union" || normalized === "unionbank") {
          return "union";
        }
        if (normalized === "keystone" || normalized === "keystonebank") {
          return "keystone";
        }
        if (normalized === "polaris" || normalized === "polarisbank") {
          return "polaris";
        }
        if (normalized === "fidelity" || normalized === "fidelitybank") {
          return "fidelity";
        }
        if (normalized === "ecobank") {
          return "ecobank";
        }

        return normalized;
      };

      const resolveBankCodeFromInstitutions = (
        insts: RampInstitution[],
        bankName: string,
        fallbackCode: string,
      ): { code: string; name: string } => {
        const target = normalizeBankName(bankName);
        if (!target) return { code: fallbackCode, name: bankName };

        const exact = insts.find((b) => normalizeBankName(b.name) === target);
        if (exact) return { code: exact.code, name: exact.name };

        const partial = insts.find((b) => {
          const n = normalizeBankName(b.name);
          return n.length > 2 && (n.includes(target) || target.includes(n));
        });
        if (partial) return { code: partial.code, name: partial.name };

        return { code: fallbackCode, name: bankName };
      };

      const resolved = resolveBankCodeFromInstitutions(
        institutions,
        contact.bankName,
        contact.bankCode,
      );
      setBankDetails({
        bankCode: resolved.code,
        bankName: resolved.name,
        accountNumber: contact.accountNumber,
        accountName: contact.accountName,
      });
    },
    [institutions],
  );

  // Bank Auto-Verification
  const handleVerifyBank = useCallback(async (details: BankDetails) => {
    if (
      details.accountNumber.length < 8 ||
      !details.bankCode
    )
      return;

    setVerifyingBank(true);
    try {
      const res = await verifyBankAccount(
        details.bankCode,
        details.accountNumber,
        fiatCurrency,
        offRampProvider,
      );
      let name =
        typeof res.data === "string" ? res.data : res.data?.accountName;
      if (!name) {
        throw new Error("Could not verify account for these bank details.");
      }
      if (name.trim().toUpperCase() === "OK") {
        name = "VERIFIED ACCOUNT";
      }
      setBankDetails((prev) => ({ ...prev, accountName: name }));

      // Mobile money has no name enquiry, so the wording stays on what was actually checked
      // — the number — without claiming we confirmed the recipient.
      toast.success(
        res.nameVerified === false
          ? "Mobile money number accepted"
          : "Bank account verified",
      );
    } catch (err) {
      toast.error(parseFriendlyError(err));
      setBankDetails((prev) => ({ ...prev, accountName: "" }));
    } finally {
      setVerifyingBank(false);
    }
  }, [fiatCurrency, offRampProvider]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (
        bankDetails.accountNumber.length >= 8 &&
        bankDetails.bankCode &&
        !bankDetails.accountName &&
        !verifyingBank
      ) {
        handleVerifyBank(bankDetails);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [bankDetails.accountNumber, bankDetails.bankCode, bankDetails.accountName, verifyingBank, handleVerifyBank]);

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
    const baseAmount = calculatePaycrestBaseAmount(val, feePercent);
    const estimatedUsdc = baseAmount / (rate || 1);
    if (estimatedUsdc <= 1) {
      toast.error("Estimated deposit must be greater than 1 USDC");
      return;
    }

    // Early KYC & Limit Pre-Check — block immediately at step 1
    try {
      const { checkKycLimitAction } = await import("@/lib/kyc/guard");
      const guard = await checkKycLimitAction(estimatedUsdc);
      if (!guard.allowed) {
        toast.error(guard.message);
        return;
      }
    } catch (err) {
      console.error("[Deposit] Early KYC check error:", err);
    }

    setLoading(true);
    try {
      const res = await initiateOnRamp({
        amountFiat: val,
        userAddress,
        refundAccount: {
          institution: bankDetails.bankCode,
          accountIdentifier: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        },
        fiatCurrency,
        network: depositNetwork,
      });
      setOrder(res);
      setStep(2);
    } catch (err) {
      toast.error(parseFriendlyError(err));
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
      val = val / rate; // base USDC needed
    }

    if (isNaN(val) || val < 1) {
      toast.error("Minimum withdrawal is 1 USDC equivalent");
      return;
    }

    // Include the platform fee (provider-specific) in the balance check — the input is the
    // base, so the fee is added on top of it.
    // base + our platform fee + the provider's corridor fee — all three leave the user's
    // wallet, so all three must be covered before we route or bridge anything.
    const totalUsdcRequired = totalFromBase(val, feePercent) + corridorFee;

    // Early KYC & Limit Pre-Check — block immediately at step 1 before bank details, 2FA, or signing
    try {
      const { checkKycLimitAction } = await import("@/lib/kyc/guard");
      const guard = await checkKycLimitAction(totalUsdcRequired);
      if (!guard.allowed) {
        toast.error(guard.message);
        return;
      }
    } catch (err) {
      console.error("[Withdraw] Early KYC check error:", err);
    }

    // A Paycrest order settles on one network, so we must source the whole amount from
    // a single Paycrest-supported chain. Route to one that holds enough.
    const routeBalances: ChainBalances & { solana?: number; stellar?: number } = {
      ...(chainBalances && Object.keys(chainBalances).length > 0
        ? chainBalances
        : { base: parseFloat(balance) || 0 }),
      solana: solanaSource?.balance ?? 0,
      stellar: stellarBalance ?? 0,
    };

    const route = planWithdrawalRoute(totalUsdcRequired.toFixed(6), routeBalances, {
      supportedChains: rampNetworks,
      homeChain: "base",
      source: sourcePref,
    });

    const combinedAvailable =
      route.totalAvailable + (solanaSource?.balance ?? 0) + (stellarBalance ?? 0);

    // Settling directly on Solana is a distinct path: funds must already be on Solana (no
    // bridging TO Solana), and the payout is a Solana SPL transfer — not an EVM route.
    const isSolanaSettlement = sourcePref.mode === "single" && sourcePref.chain === "solana";

    // Validate a manual override before proceeding (Solana is validated separately below).
    if (sourcePref.mode === "single" && !isSolanaSettlement && !route.feasible) {
      toast.error(
        `${sourcePref.chain} doesn't hold enough to withdraw ${totalUsdcRequired.toFixed(2)} USDC.`,
      );
      return;
    }
    if (sourcePref.mode === "consolidate") {
      const selSum = sourcePref.from.reduce(
        (s, c) => {
          if (c === "solana") return s + (solanaSource?.balance ?? 0);
          if (c === "stellar") return s + (stellarBalance ?? 0);
          return s + (routeBalances[c] ?? 0);
        },
        0,
      );
      if (selSum + 1e-9 < totalUsdcRequired) {
        toast.error(
          `Selected networks hold $${selSum.toFixed(2)} — need ${totalUsdcRequired.toFixed(2)} USDC.`,
        );
        return;
      }
    }

    if (isSolanaSettlement) {
      // Settle on Solana — requires enough USDC already on Solana; no consolidation.
      const solBal = solanaSource?.balance ?? 0;
      if (solBal + 1e-9 < totalUsdcRequired) {
        toast.error(
          `Solana holds $${solBal.toFixed(2)} — need ${totalUsdcRequired.toFixed(2)} USDC.`,
        );
        return;
      }
      if (!solanaSource?.settleOffRamp) {
        toast.error("Connect your Solana wallet to settle on Solana.");
        return;
      }
      setWithdrawChain("solana");
      setMustConsolidate(false);
      setConsolidateFrom(null);
    } else if (route.feasible && route.chain) {
      // A single supported chain holds enough — source straight from it.
      setWithdrawChain(route.chain as RampNetwork);
      setMustConsolidate(false);
      setConsolidateFrom(null);
    } else if (
      route.needsConsolidation ||
      combinedAvailable + 1e-9 >= totalUsdcRequired
    ) {
      const targetChain = route.chain ?? "base";
      setWithdrawChain(targetChain as RampNetwork);
      setMustConsolidate(true);
      setConsolidateFrom(route.consolidateFrom ?? null);
    } else {
      toast.error(
        `Insufficient balance. Requires ${totalUsdcRequired.toFixed(2)} USDC`,
      );
      return;
    }

    // Save the computed base USDC required for the next steps
    // without overwriting the user's input amount
    setQuoteUsdcAmount(val.toFixed(6));

    setLoading(true);
    try {
      const res = await getOffRampQuote(val, fiatCurrency);
      setQuote(res);
      setStep(2);
    } catch (err) {
      toast.error(parseFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawFinalize = async () => {
    if (!bankDetails.accountName) {
      toast.error("Please verify destination account");
      return;
    }

    const amountUsdc = parseFloat(quoteUsdcAmount);

    // Total amount that will be deducted including the platform fee (provider-specific).
    const totalUsdcRequired = totalFromBase(amountUsdc, feePercent) + corridorFee;

    if (totalUsdcRequired >= twoFaThreshold) {
      if (!twoFaEnabled) {
        toast.error(
          `Withdrawals over ${twoFaThreshold} USDC require 2FA. Please enable it in Settings.`,
        );
        return;
      }

      // 2FA Required - open modal without sending OTP
      setTwoFaModalOpen(true);
      return;
    }

    await executeWithdrawalActual();
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
        // Passkey is already verified, just proceed with the actual withdrawal
        setTwoFaModalOpen(false);
        await executeWithdrawalActual();
        return;
      }

      if (method === "totp") {
        // Use TOTP verification endpoint
        res = await fetch("/api/2fa/totp/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: userEmail,
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
            userEmail,
            otp_id: twoFaOtpId,
            otp_code: code,
          }),
        });
      }

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
      const amountUsdc = parseFloat(quoteUsdcAmount);
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
      // Auto-consolidate onto the SETTLEMENT chain first when funds are split across chains.
      // Done before creating the off-ramp order so the order's transfer window starts fresh.
      if (mustConsolidate && embeddedProvider) {
        const targetChain = withdrawChain as SupportedChain | "stellar" | "solana";
        const targetName = targetChain === "stellar" ? "Stellar" : targetChain === "solana" ? "Solana" : (CHAIN_NAMES[targetChain as SupportedChain] ?? targetChain);
        // Bring over base + platform fee + corridor fee. Each is a separate outflow from this
        // chain, so consolidating only the base strands the withdrawal a fee short — and after
        // a CCTP bridge, which is slow and not worth repeating.
        const required = (
          totalFromBase(parseFloat(quoteUsdcAmount), feePercent) + corridorFee
        ).toFixed(6);
        // Honour the user's chosen networks (if any); otherwise pull from everything.
        const allBalances: ChainBalances & { solana?: number; stellar?: number } = {
          ...(chainBalances ?? {}),
          solana: solanaSource?.balance ?? 0,
          stellar: stellarBalance ?? 0,
        };
        const sourceBalances: ChainBalances & { solana?: number; stellar?: number } = consolidateFrom
          ? Object.fromEntries(
              (Object.keys(allBalances) as (keyof typeof allBalances)[])
                .filter((c) => consolidateFrom.includes(c as SourceChainKey))
                .map((c) => [c, allBalances[c]]),
            )
          : allBalances;
        const includeSolana = consolidateFrom
          ? consolidateFrom.includes("solana")
          : true;
        const includeStellar = consolidateFrom
          ? consolidateFrom.includes("stellar")
          : true;
        const stellarSource = (stellarAddress && stellarWalletId && stellarBalance > 0)
          ? {
              walletId: stellarWalletId,
              address: stellarAddress,
              balance: stellarBalance,
              bridgeToBase: async (amount: string, recipient: string, onStatus?: (status: string) => void, destChain?: SupportedChain) => {
                await bridgeStellarToBase({
                  walletId: stellarWalletId,
                  senderAddress: stellarAddress,
                  amount,
                  recipientEvm: recipient,
                  evmWallet: embeddedProvider,
                  destChain,
                  onStatus,
                });
              }
            }
          : undefined;
        toast.loading(`Securing bridge transaction on ${targetName}…`, { id: "consolidate" });
        await consolidateFundsToChain(embeddedProvider, {
          targetChain,
          requiredAmount: required,
          balances: sourceBalances,
          recipient: userAddress,
          stellarRecipient: stellarAddress,
          solana: includeSolana ? solanaSource : undefined,
          stellar: includeStellar ? stellarSource : undefined,
          onStatus: (s) => toast.loading(s, { id: "consolidate" }),
        });
        toast.success(`Funds secured & ready on ${targetName}.`, { id: "consolidate", duration: 5000 });
      }

      // Submit via the pinned-provider flow using the CANONICAL bank identity (name, not
      // a raw code). executeOffRamp resolves the right bank_code per provider and falls
      // back (re-resolving) if the first provider can't create the order.
      const { order: res } = await executeOffRamp({
        amountUsdc: parseFloat(quoteUsdcAmount),
        fiatAmount: inputMode === "fiat" ? parseFloat(amount) : quote?.payoutAmount,
        exchangeRate: quote?.rate,
        inputMode,
        bank: {
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
          bankName: bankDetails.bankName || bankDetails.bankCode,
          memo: bankDetails.memo,
        },
        userRefundAddress: userAddress,
        fiatCurrency,
        network: withdrawChain,
        consolidated: mustConsolidate,
      });
      setOrder(res);
      setStep(3);
    } catch (err) {
      toast.dismiss("consolidate");
      toast.error(parseFriendlyError(err));
    } finally {
      setLoading(false);
    }
  };

  const executeTransfer = async () => {
    const receiveAddress = order?.providerAccount?.receiveAddress;
    if (!order || !receiveAddress) return;

    const settlementChain = (order.providerAccount?.network ?? withdrawChain) as string;
    const baseAmount = parseFloat(quoteUsdcAmount);
    // Fee is resolved server-side and embedded in the order: `onchain` collection carries a
    // treasury address (we route the fee there ourselves); `provider` collection is skimmed by
    // the provider (we just send base + fee to its single receive address).
    const fee = order.fee;
    const onchainFee =
      fee?.collection === "onchain" && fee.address && parseFloat(fee.usdc) > 0
        ? { address: fee.address, usdc: fee.usdc }
        : null;

    // Last balance check before any money moves. The earlier checks use our own corridor-fee
    // config; this one uses the fee the order actually came back with, so a config drift can't
    // leave an orphan payout parked in `pending_address_deposit` after a failed transfer.
    const totalToSend =
      parseFloat(baseAmount.toFixed(6)) +
      parseFloat(order.bitnobFee || "0") +
      (fee ? parseFloat(fee.usdc) : 0);

    const availableOnChain =
      settlementChain === "solana"
        ? (solanaSource?.balance ?? 0)
        : settlementChain === "stellar"
          ? stellarBalance
          : (chainBalances?.[settlementChain as SupportedChain] ?? (parseFloat(balance) || 0));

    if (availableOnChain + 1e-9 < totalToSend) {
      console.error("[Withdraw] insufficient balance — withdrawal not submitted");
      toast.error("Not enough balance to complete this withdrawal.");
      return;
    }

    setTransferring(true);
    try {
      let txHash: string;

      if (settlementChain === "solana") {
        // Settle directly on Solana: sponsored SPL transfer(s) — payout (+ fee) in one tx.
        if (!solanaSource?.settleOffRamp) {
          throw new Error("Connect your Solana wallet to settle this withdrawal on Solana.");
        }
        const bitnobFee = parseFloat(order.bitnobFee || "0");
        const bitnobPayoutDeposit = baseAmount + bitnobFee;
        txHash = await solanaSource.settleOffRamp({
          payoutAddress: receiveAddress,
          payoutAmount: bitnobPayoutDeposit.toFixed(6),
          feeAddress: onchainFee?.address,
          feeAmount: onchainFee?.usdc,
          onStatus: (s) => toast.loading(s, { id: "wd-settle" }),
        });
        toast.dismiss("wd-settle");
      } else if (settlementChain === "stellar") {
        // Settle directly on Stellar: fee-bumped payment — payout (+ fee) directly to Bitnob.
        if (!stellarAddress || !stellarWalletId) {
          throw new Error("Connect your Stellar wallet to settle this withdrawal on Stellar.");
        }
        const bitnobFee = parseFloat(order.bitnobFee || "0");
        const bitnobPayoutDeposit = baseAmount + bitnobFee;
        toast.loading("Submitting direct Stellar withdrawal transaction…", { id: "wd-settle" });

        const res = await fetch("/api/stellar/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: stellarWalletId,
            senderAddress: stellarAddress,
            recipientAddress: receiveAddress,
            amount: bitnobPayoutDeposit.toFixed(6),
            // The order's fee, same as the EVM and Solana branches — without it the route
            // prices this at the P2P transfer rate.
            feeAmount: onchainFee?.usdc ?? "0",
            // Lets the route record the hash server-side, so the deposit stays attributable to
            // this withdrawal even if this tab never comes back.
            withdrawalOrderId: order.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to submit Stellar withdrawal transaction.");
        // The route returns `txHash` (see app/api/stellar/send). Reading `hash` here left every
        // Stellar withdrawal with no hash at all: none was persisted, and the finalize call fell
        // back to matching on Bitnob's static Stellar address — which is shared by every payout.
        txHash = data.txHash;
        toast.dismiss("wd-settle");
      } else {
        if (!embeddedProvider) return;
        const provider = await embeddedProvider.getEthereumProvider();
        const evmChain = settlementChain as SupportedChain;

        const bitnobFee = parseFloat(order.bitnobFee || "0");
        const bitnobPayoutDeposit = baseAmount + bitnobFee;

        if (onchainFee) {
          // One gasless UserOp: payout to the provider (including Bitnob rail fee) + fee to our treasury.
          txHash = await executeCircleGaslessBatchTransfer(
            provider,
            [
              { recipientAddress: receiveAddress, amountUSDC: bitnobPayoutDeposit.toFixed(6) },
              { recipientAddress: onchainFee.address, amountUSDC: onchainFee.usdc },
            ],
            evmChain,
          );
        } else {
          // Provider-collected fee (or no fee): send base + fee to the single receive address.
          const total = fee ? bitnobPayoutDeposit + parseFloat(fee.usdc) : bitnobPayoutDeposit;
          txHash = await executeCircleGaslessTransfer(
            provider,
            receiveAddress,
            total.toFixed(6),
            evmChain,
          );
        }
      }

      setWithdrawalTxHash(txHash);
      if (order.id && txHash) {
        saveWithdrawalTxHash(order.id, txHash).catch(console.error);
      }
      if (order.provider === "bitnob" && order.providerRef) {
        const ref = order.providerRef;
        // Pass what identifies OUR deposit so the action can confirm the money actually
        // landed before releasing the payout — broadcasting a transfer is not receiving it.
        const depositAmount = baseAmount + parseFloat(order.bitnobFee || "0");

        if (order.deferredInitialize) {
          // On this chain no payout exists yet: the beneficiary is attached only once this
          // deposit is verified, so this call is what creates it. If it fails, nothing pays
          // out — say so rather than leaving the user watching a spinner.
          import("@/lib/actions/ramp")
            .then(({ settleDeferredBitnobPayoutAction }) =>
              settleDeferredBitnobPayoutAction({
                quoteId: ref,
                orderId: order.id,
                txHash,
                requiredUsdc: depositAmount,
                network: settlementChain,
                fiatCurrency,
                bank: {
                  accountNumber: bankDetails.accountNumber,
                  accountName: bankDetails.accountName,
                  bankName: bankDetails.bankName || bankDetails.bankCode,
                  memo: bankDetails.memo,
                },
              }),
            )
            .then((res) => {
              if (!res?.ok) {
                toast.error(
                  `Your transfer arrived but the payout could not be created${res?.reason ? `: ${res.reason}` : ""}. Support can complete it.`,
                  { duration: 10000 },
                );
              }
            })
            .catch(console.error);
        } else {
          import("@/lib/actions/ramp").then(({ finalizeBitnobPayoutAction }) => {
            finalizeBitnobPayoutAction(ref, {
              address: receiveAddress,
              txHash,
              amountUsdc: depositAmount,
            });
          }).catch(console.error);
        }
      }
      toast.success("Transfer sent! Waiting for payout confirmation...");
      queryClient.invalidateQueries({ queryKey: ["balance", userAddress] });
      setStep(4);
      startPolling();
    } catch (err) {
      toast.dismiss("wd-settle");
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
        const result = await getOrderStatus(order.id, order.provider);
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
              // IMPORTANT: use reconcileOrderStatus (calls finalize_withdrawal_success RPC)
              // which atomically updates locked_balance. Do NOT call updateWithdrawalStatus() directly.
              reconcileOrderStatus(order.id, result.status, 'withdrawal').catch(console.error);
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
              // IMPORTANT: use reconcileOrderStatus (calls finalize_withdrawal_failed RPC)
              // which atomically refunds locked_balance → available_balance.
              reconcileOrderStatus(order.id, result.status, 'withdrawal').catch(console.error);
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
  }, [
    order?.id,
    order?.provider,
    type,
    bankContacts,
    queryClient,
    userAddress,
    bankDetails.accountNumber,
    onClose,
  ]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const refreshBankContacts = useCallback(async () => {
    if (userEmail) {
      const contacts = await getUserBankContacts().catch(() => []);
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
    institutionsLoading,
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
    quoteUsdcAmount,
    withdrawChain,
    mustConsolidate,
    sourcePref,
    setSourcePref,
    chainBalances: chainBalances ?? {},
    solanaBalance: solanaSource?.balance ?? 0,
    stellarBalance: stellarBalance ?? 0,
    rampNetworks,
    offRampProvider,
    feePercent,
    depositNetwork,
    setDepositNetwork,
    // On-ramp (Paycrest) lands USDC on these chains; default Base.
    depositNetworks: RAMP_NETWORKS,
    userEmail,
    userAddress,
    handleSelectContact,
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
    totpEnabled,
    passkeyEnabled,
    handleSaveBankContact: async () => {
      try {
        await addBankContact({
          bankName: bankDetails.bankName,
          bankCode: bankDetails.bankCode,
          accountNumber: bankDetails.accountNumber,
          accountName: bankDetails.accountName,
        });
        toast.success("Bank account saved!");
        setShowSavePrompt(false);
        getUserBankContacts()
          .then(setBankContacts)
          .catch(console.error);
        if (type === "withdraw") {
          setTimeout(() => onClose?.(), 1000);
        }
      } catch (err) {
        toast.error(parseFriendlyError(err));
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
      setWithdrawChain("base");
      setMustConsolidate(false);
      setSourcePref(AUTO_SOURCE);
      setConsolidateFrom(null);
      setDepositNetwork("base");
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
