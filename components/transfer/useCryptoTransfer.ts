import { useState, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ConnectedWallet } from "@privy-io/react-auth";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { toast } from "sonner";
import { parseFriendlyError } from "./useTransfer";
import { SupportedChain, CHAIN_NAMES } from "@/lib/circle/gateway";
import { getUSDCBalance } from "@/lib/web3/actions";
import { isAddress } from "viem";

interface UseCryptoTransferProps {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  senderEmail: string;
}

export function useCryptoTransfer({
  smartAddress,
  embeddedProvider,
  senderEmail,
}: UseCryptoTransferProps) {
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedChain, setSelectedChain] = useState<SupportedChain>("base");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

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

  // Query balance for the selected chain
  const { data: balance = "0.00", isFetching: isFetchingBalance } = useQuery({
    queryKey: ["balance", smartAddress, selectedChain],
    queryFn: () => getUSDCBalance(smartAddress, selectedChain),
    enabled: !!smartAddress && !!selectedChain,
  });

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
        setTwoFaModalOpen(false);
        await executeTransferActual();
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

  const executeTransferActual = async () => {
    if (!amount || !recipientAddress || !embeddedProvider) return;
    setLoading(true);
    setStatus("Initiating transfer...");

    try {
      const provider = await embeddedProvider.getEthereumProvider();
      setStatus("Requesting signature...");

      const txHash = await executeCircleGaslessTransfer(
        provider,
        recipientAddress,
        amount,
        selectedChain
      );

      toast.success("Transfer completed!");
      setStatus("");

      // Record transfer in DB
      const { recordTransfer } = await import("@/lib/supabase/transactions");
      await recordTransfer({
        senderEmail,
        recipientEmail: recipientAddress,
        amount: parseFloat(amount),
        status: "completed",
        note: `Crypto transfer on ${CHAIN_NAMES[selectedChain]}`,
        txHash: txHash as string,
      });

      queryClient.invalidateQueries({ queryKey: ["balance", smartAddress, selectedChain] });
      queryClient.invalidateQueries({ queryKey: ["history", senderEmail] });

      setAmount("");
      setRecipientAddress("");
    } catch (err) {
      console.error("[Crypto Transfer] Fatal Error:", err);
      toast.error(parseFriendlyError(err));
      setStatus("");
    }
    setLoading(false);
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
  };
}
