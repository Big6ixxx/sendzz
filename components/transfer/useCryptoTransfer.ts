import { useState, useEffect } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ConnectedWallet, usePrivy, useSigners } from "@privy-io/react-auth";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { toast } from "sonner";
import { parseFriendlyError } from "./useTransfer";
import { SupportedChain } from "@/lib/circle/gateway";
import { getUSDCBalance } from "@/lib/web3/actions";
import { isAddress } from "viem";

interface UseCryptoTransferProps {
  smartAddress: string;
  embeddedProvider?: ConnectedWallet;
  senderEmail: string;
}

const ALL_CHAIN_NAMES: Record<SupportedChain | 'stellar', string> = {
  base: 'Base',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  stellar: 'Stellar',
};

export function useCryptoTransfer({
  smartAddress,
  embeddedProvider,
  senderEmail,
}: UseCryptoTransferProps) {
  const [recipientAddress, setRecipientAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedChain, setSelectedChain] = useState<SupportedChain | 'stellar'>("base");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [isSettingUpStellar, setIsSettingUpStellar] = useState(false);

  const queryClient = useQueryClient();
  const { user } = usePrivy();
  const { addSigners } = useSigners();
  const privyUserId = user?.id;

  // Load Stellar TEE wallet details
  const { data: stellarWallet } = useQuery({
    queryKey: ["stellar-wallet", privyUserId],
    queryFn: async () => {
      if (!privyUserId) return null;
      const cached = localStorage.getItem(`sendzz:stellar:v2:${privyUserId}`);
      if (cached) {
        try {
          return JSON.parse(cached) as {
            walletId: string;
            address: string;
            trustlineReady: boolean;
            signerGranted: boolean;
          };
        } catch {}
      }
      return null;
    },
    enabled: !!privyUserId && selectedChain === 'stellar',
  });

  const ensureStellarSetup = async () => {
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
        body: JSON.stringify({ privyUserId }),
      });
      const provData = await provRes.json();
      if (!provRes.ok) throw new Error(provData.error || 'Provisioning failed');

      const walletAddress = provData.address;
      const walletId = provData.walletId;

      // Check if signer needs to be granted
      const cached = localStorage.getItem(`sendzz:stellar:v2:${privyUserId}`);
      const cachedParsed = cached ? JSON.parse(cached) : null;

      if (!cachedParsed?.signerGranted) {
        setStatus("Authorizing signing access in Privy TEE...");
        try {
          await addSigners({
            address: walletAddress,
            signers: [{ signerId: keyQuorumId }],
          });
        } catch (err: any) {
          if (!err.message?.toLowerCase().includes('duplicate')) {
            throw err;
          }
        }
      }

      // Provision once more to ensure trustline and active state on-chain
      setStatus("Activating account & setting trustline...");
      const finalRes = await fetch('/api/stellar/provision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyUserId }),
      });
      const finalData = await finalRes.json();
      if (!finalRes.ok) throw new Error(finalData.error || 'Final setup failed');

      const info = {
        walletId: finalData.walletId || walletId,
        address: finalData.address || walletAddress,
        trustlineReady: finalData.trustlineReady || false,
        signerGranted: true,
      };
      localStorage.setItem(`sendzz:stellar:v2:${privyUserId}`, JSON.stringify(info));
      
      queryClient.invalidateQueries({ queryKey: ["stellar-wallet", privyUserId] });
      queryClient.invalidateQueries({ queryKey: ["balance", smartAddress, selectedChain, info.address] });

      setStatus("");
      setIsSettingUpStellar(false);
      return info;
    } catch (err: any) {
      console.error("Stellar setup error:", err);
      toast.error(`Stellar setup failed: ${err.message || err}`);
      setStatus("");
      setIsSettingUpStellar(false);
      return null;
    }
  };

  // Auto-setup Stellar when selected
  useEffect(() => {
    if (selectedChain === "stellar" && privyUserId) {
      const cached = localStorage.getItem(`sendzz:stellar:v2:${privyUserId}`);
      const cachedParsed = cached ? JSON.parse(cached) : null;
      if (!cachedParsed || !cachedParsed.trustlineReady || !cachedParsed.signerGranted) {
        ensureStellarSetup();
      }
    }
  }, [selectedChain, privyUserId]);

  // Query balance for the selected chain
  const { data: balance = "0.00", isFetching: isFetchingBalance } = useQuery({
    queryKey: ["balance", smartAddress, selectedChain, stellarWallet?.address],
    queryFn: async () => {
      if (selectedChain === "stellar") {
        if (!stellarWallet?.address) return "0.00";
        const res = await fetch(`/api/stellar/balance?address=${stellarWallet.address}`);
        if (!res.ok) return "0.00";
        const data = await res.json();
        return data.usdc || "0.00";
      }
      return getUSDCBalance(smartAddress, selectedChain);
    },
    enabled: !!smartAddress && !!selectedChain && (selectedChain !== "stellar" || !!stellarWallet?.address),
  });

  const handleTransfer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!amount || !recipientAddress) return;

    if (selectedChain === "stellar") {
      if (!recipientAddress.startsWith("G") || recipientAddress.length !== 56) {
        toast.error("Invalid Stellar recipient address. It must be a G-address.");
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
      } else {
        if (!embeddedProvider) {
          throw new Error("Wallet provider not connected.");
        }
        const provider = await embeddedProvider.getEthereumProvider();
        setStatus("Requesting signature...");

        txHash = await executeCircleGaslessTransfer(
          provider,
          recipientAddress,
          amount,
          selectedChain
        );
      }

      toast.success("Transfer completed!");
      setStatus("");

      // Record transfer in DB
      const { recordTransfer } = await import("@/lib/supabase/transactions");
      await recordTransfer({
        senderEmail,
        recipientEmail: recipientAddress,
        amount: parseFloat(amount),
        status: "completed",
        note: `Crypto transfer on ${ALL_CHAIN_NAMES[selectedChain]}`,
        txHash: txHash as string,
      });

      if (selectedChain === "stellar") {
        queryClient.invalidateQueries({ queryKey: ["balance", smartAddress, selectedChain, stellarWallet?.address] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["balance", smartAddress, selectedChain] });
      }
      queryClient.invalidateQueries({ queryKey: ["history", senderEmail] });

      setAmount("");
      setRecipientAddress("");
      setMemo("");
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
  };
}
