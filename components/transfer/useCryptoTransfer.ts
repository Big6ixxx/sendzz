import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { ConnectedWallet } from "@privy-io/react-auth";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { toast } from "sonner";
import { parseFriendlyError } from "./useTransfer";
import { SupportedChain, CHAIN_NAMES, SMART_BRIDGE_CHAINS } from "@/lib/circle/gateway";
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

  const queryClient = useQueryClient();

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
        recipientEmail: recipientAddress, // Storing address in email column or we need a new column? Sendzz seems to store it in recipientEmail based on existing DB setup or we can append `[External Wallet]`? For now, we will store it directly.
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
  };
}
