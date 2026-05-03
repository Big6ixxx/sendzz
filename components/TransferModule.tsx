"use client";

import { sendTransferEmail } from "@/lib/email/sendEmail";
import { getUserAddressByEmail } from "@/lib/supabase/actions";
import { executeCircleGaslessTransfer } from "@/lib/web3/circle-actions";
import { Loader2, Send } from "lucide-react";
import { useState } from "react";

export function TransferModule({
  smartAddress,
  embeddedProvider,
  balance,
  senderEmail,
}: {
  smartAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embeddedProvider: any;
  balance: string;
  senderEmail: string;
}) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  const handleTransfer = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!amount || !recipientEmail || !embeddedProvider) return;

    setLoading(true);
    setStatus("Looking up identity strictly...");

    try {
      let recipientAddress = await getUserAddressByEmail(recipientEmail);
      
      if (!recipientAddress) {
        setStatus("Recipient not found. Pre-generating smart wallet (JIT)...");
        
        // Call the new API to generate the Privy user and get the deterministic address
        const res = await fetch('/api/wallets/pre-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: recipientEmail })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || 'Failed to pre-generate wallet');
        }
        
        recipientAddress = data.address as string;
        console.log(`[JIT] Pre-generated Circle Address for ${recipientEmail}:`, recipientAddress);
        setStatus(`Generated New Address: ${(recipientAddress as string).substring(0, 8)}... Requesting signature...`);
      } else {
        console.log(`[Transfer] Existing Circle Address for ${recipientEmail}:`, recipientAddress);
        setStatus(`Identity confirmed: ${(recipientAddress as string).substring(0, 8)}... Requesting signature...`);
      }


      const provider = await embeddedProvider.getEthereumProvider();
      const txHash = await executeCircleGaslessTransfer(
        provider,
        recipientAddress as string,
        amount,
      );

      setStatus(`SUCCESS: TX Hash ${txHash}`);

      // Notify recipient — fire and forget, don't block the UI
      sendTransferEmail(recipientEmail, amount, senderEmail).catch(console.error);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setStatus(`FATAL: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="brutal-card p-6 md:p-10 bg-neon text-black h-full">
      <h2 className="font-oswald text-3xl md:text-5xl uppercase font-black mb-8 border-b-4 border-black pb-4 flex items-center gap-4">
        <Send className="w-10 h-10 md:w-14 md:h-14" /> P2P execution engine
      </h2>

      <form onSubmit={handleTransfer} className="flex flex-col gap-6">
        <div>
          <label className="font-mono text-sm font-bold uppercase block mb-2">
            Target Email Identifier
          </label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="brutal-input text-xl focus:bg-white! focus:text-black!"
            placeholder="RECEIVER@SENDZZ.IO"
            required
          />
        </div>

        <div>
          <label className="font-mono text-sm font-bold uppercase block mb-2">
            USDC Principal Amount
          </label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="brutal-input text-4xl md:text-6xl font-black font-oswald focus:bg-white! focus:text-black!"
            placeholder="0.00"
            required
          />
        </div>

        <button
          type="submit"
          disabled={
            loading ||
            !smartAddress ||
            parseFloat(balance) === 0 ||
            parseFloat(amount || "0") > parseFloat(balance)
          }
          className={`brutal-btn mt-4 text-xl md:text-2xl py-4 flex items-center justify-center gap-4 w-full bg-black text-neon hover:bg-white hover:text-black ${parseFloat(balance) === 0 || parseFloat(amount || "0") > parseFloat(balance) ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : parseFloat(balance) === 0 ? (
            "INSUFFICIENT BALANCE"
          ) : parseFloat(amount || "0") > parseFloat(balance) ? (
            "EXCEEDS BALANCE"
          ) : (
            "EXECUTE SPONSORED TRANSFER"
          )}
        </button>

        {status && (
          <div className="mt-4 p-4 border-4 border-black font-mono text-sm font-bold bg-white text-black wrap-break-word">
            &gt; SYSTEM LOG: {status}
          </div>
        )}
      </form>
    </div>
  );
}
