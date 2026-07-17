import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ConnectedWallet, usePrivy, useSigners } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import { Connection } from '@solana/web3.js';
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
  destChain: SupportedChain | 'stellar' | 'solana';
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
  const [selectedChain, setSelectedChain] = useState<SupportedChain | 'stellar' | 'solana'>("base");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [isSettingUpStellar, setIsSettingUpStellar] = useState(false);
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

  const solanaConnection = useMemo(() => new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    'confirmed'
  ), []);

  const queryClient = useQueryClient();
  const { user } = usePrivy();
  const { addSigners } = useSigners();
  const privyUserId = user?.id;

  // Load Stellar TEE wallet details
  const { data: stellarWallet } = useQuery({
    queryKey: ["stellar-wallet", privyUserId],
    queryFn: async () => {
      if (!privyUserId || !user?.email?.address) return null;
      try {
        const res = await fetch("/api/stellar/provision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privyUserId, email: user.email.address }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          walletId: data.walletId,
          address: data.address,
          trustlineReady: data.trustlineReady,
          signerGranted: data.signerGranted || false,
        };
      } catch {
        return null;
      }
    },
    enabled: !!privyUserId && !!user?.email?.address && selectedChain === 'stellar',
  });

  const ensureStellarSetup = useCallback(async () => {
    if (!privyUserId) return null;
    setIsSettingUpStellar(true);
    setStatus("Checking Stellar wallet status...");
    try {
      // 1. Get signer ID
      const signerRes = await fetch('/api/stellar/signer-id');
      if (!signerRes.ok) throw new Error('Could not get signer ID');
      const { keyQuorumId } = await signerRes.json();

      // 2. Provision (creates wallet if needed)
      setStatus("Provisioning Stellar wallet in TEE...");
      const provRes = await fetch('/api/stellar/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId, email: senderEmail }),
      });
      const provData = await provRes.json();
      if (!provRes.ok) throw new Error(provData.error || 'Provisioning failed');

      const walletAddress = provData.address;
      const walletId = provData.walletId;
      const isSignerGranted = provData.signerGranted || false;

      if (!isSignerGranted) {
        setStatus("Authorizing signing access in Privy TEE...");
        try {
          await addSigners({
            address: walletAddress,
            signers: [{ signerId: keyQuorumId }],
          });
          
          // Save in database that the signer is now granted
          const { registerStellarAddress } = await import("@/lib/supabase/users");
          await registerStellarAddress(senderEmail, walletAddress, walletId, true);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (!errMsg.toLowerCase().includes('duplicate')) {
            throw err;
          }
        }
      }

      // Provision once more to ensure trustline and active state on-chain
      setStatus("Activating account & setting trustline...");
      const finalRes = await fetch('/api/stellar/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId, email: senderEmail }),
      });
      const finalData = await finalRes.json();
      if (!finalRes.ok) throw new Error(finalData.error || 'Final setup failed');

      const info = {
        walletId: finalData.walletId || walletId,
        address: finalData.address || walletAddress,
        trustlineReady: finalData.trustlineReady || false,
        signerGranted: true,
      };
      
      queryClient.invalidateQueries({ queryKey: ["stellar-wallet", privyUserId] });
      queryClient.invalidateQueries({ queryKey: ["balance-stellar", info.address] });

      setStatus("");
      setIsSettingUpStellar(false);
      return info;
    } catch (err: unknown) {
      console.error("Stellar setup error:", err);
      setStatus("");
      setIsSettingUpStellar(false);
      return null;
    }
  }, [privyUserId, addSigners, queryClient, senderEmail]);

  // Auto-setup Stellar when selected
  useEffect(() => {
    if (selectedChain === "stellar" && privyUserId) {
      if (!stellarWallet || !stellarWallet.trustlineReady || !stellarWallet.signerGranted) {
        ensureStellarSetup();
      }
    }
  }, [selectedChain, privyUserId, ensureStellarSetup, stellarWallet]);

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
    enabled: selectedChain === "stellar" && !!stellarWallet?.address,
  });

  const spendableNum = Object.values(chainBalances ?? {}).reduce(
    (s, n) => s + (n ?? 0),
    0,
  );

  const balance = selectedChain === "stellar"
    ? stellarUsdcBalance
    : selectedChain === "solana"
      ? (solanaSource?.balance ?? 0).toFixed(2)
      : spendableNum.toFixed(2);
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

    if (selectedChain === "stellar" || selectedChain === "solana") {
      await executeDirectTransfer();
      return;
    }

    // User override: pay entirely from one chosen chain.
    if (sourcePref.mode === "single") {
      const c = sourcePref.chain;
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
        (s, k) => {
          if (k === "solana") return s + (solanaSource?.balance ?? 0);
          if (k === "stellar") return s;
          return s + (chainBalances?.[k] ?? 0);
        },
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
    if (!amount || !recipientAddress) return;
    if (selectedChain !== "stellar" && selectedChain !== "solana" && !embeddedProvider) {
      return;
    }
    setLoading(true);
    setStatus("Requesting signature...");

    try {
      let txHash: string;

      if (selectedChain === "stellar") {
        let currentWallet = stellarWallet;
        if (!currentWallet || !currentWallet.trustlineReady || !currentWallet.signerGranted) {
          const ok = await ensureStellarSetup();
          if (!ok) {
            setLoading(false);
            return;
          }
          currentWallet = ok;
        }

        setStatus("Submitting Stellar transfer...");
        const res = await fetch("/api/stellar/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletId: currentWallet.walletId,
            senderAddress: currentWallet.address,
            recipientAddress,
            amount,
            memo: memo || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Stellar transfer failed");
        }
        txHash = data.txHash;
      } else if (selectedChain === "solana") {
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

        setStatus("Building Solana transfer transaction...");
        const { buildSolanaUsdcTransferTx } = await import("@/lib/web3/solana-bridge");
        const tx = await buildSolanaUsdcTransferTx({
          connection: solanaConnection,
          senderAddress: solAddress,
          recipientAddress,
          amount,
        });

        setStatus("Confirming on Solana...");
        const { signedTransaction } = await signTransaction({
          transaction: tx.serialize({ requireAllSignatures: false }),
          wallet: solWallet,
        });

        const sig = await solanaConnection.sendRawTransaction(signedTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });
        const bh = await solanaConnection.getLatestBlockhash();
        await solanaConnection.confirmTransaction(
          {
            signature: sig,
            blockhash: bh.blockhash,
            lastValidBlockHeight: bh.lastValidBlockHeight,
          },
          'confirmed',
        );

        txHash = sig;
      } else {
        if (!embeddedProvider) throw new Error("Wallet provider not connected.");
        const provider = await embeddedProvider.getEthereumProvider();
        txHash = await executeCircleGaslessTransfer(
          provider,
          recipientAddress,
          amount,
          selectedChain,
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
            destChain: info.destChain as SupportedChain,
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
          destChain: info.destChain as SupportedChain,
          amountUSDC: info.amount,
          recipient: info.recipient,
          onStatus: setStatus,
        });
        txHash = mintTxHash ?? burnTxHash;
      }

      setStatus("");
      await recordSentTransfer(
        txHash,
        `Cross-chain transfer to ${info.destChain === "stellar" ? "Stellar" : info.destChain === "solana" ? "Solana" : CHAIN_NAMES[info.destChain as SupportedChain]}`,
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
    memo,
    setMemo,
    loading,
    status,
    balance,
    isFetchingBalance,
    isOverBalance,
    isZeroBalance,
    isSettingUpStellar,
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
