import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Info, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { SupportedChain } from '@/lib/circle/gateway';

interface CryptoTransferFormProps {
  recipientAddress: string;
  setRecipientAddress: (address: string) => void;
  amount: string;
  setAmount: (amount: string) => void;
  selectedChain: SupportedChain | 'stellar';
  setSelectedChain: (chain: SupportedChain | 'stellar') => void;
  memo: string;
  setMemo: (memo: string) => void;
  loading: boolean;
  status: string;
  balance: string;
  isFetchingBalance: boolean;
  isOverBalance: boolean;
  isZeroBalance: boolean;
  isSettingUpStellar: boolean;
  handleTransfer: (e: React.FormEvent) => void;
}

const AVAILABLE_CHAINS: (SupportedChain | 'stellar')[] = [
  'base',
  'ethereum',
  'arbitrum',
  'optimism',
  'polygon',
  'avalanche',
  'stellar',
];

const ALL_CHAIN_NAMES: Record<SupportedChain | 'stellar', string> = {
  base: 'Base',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  stellar: 'Stellar',
};

export function CryptoTransferForm({
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
}: CryptoTransferFormProps) {
  const isStellar = selectedChain === 'stellar';

  return (
    <form
      onSubmit={handleTransfer}
      className="flex flex-col gap-6 relative z-10 animate-in fade-in slide-in-from-right-4 duration-300"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Network
            </label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger type="button">
                  <Info className="w-3 h-3 text-muted-foreground/50 hover:text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  Select the blockchain network to send USDC to.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
        
        <Select
          value={selectedChain}
          onValueChange={(val) => setSelectedChain(val as SupportedChain | 'stellar')}
        >
          <SelectTrigger className="w-full h-14 bg-white/5 border border-white/10 text-sm">
            <SelectValue placeholder="Select network" />
          </SelectTrigger>
          <SelectContent>
            {AVAILABLE_CHAINS.map((chain) => (
              <SelectItem key={chain} value={chain}>
                <div className="flex items-center gap-3">
                  <img src={`/chains/${chain}.png`} alt={chain} className="w-5 h-5 rounded-full object-cover" />
                  <span className="text-xs font-bold">{ALL_CHAIN_NAMES[chain]}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex justify-end items-center gap-2 px-1 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Available Balance:
            </span>
            {isFetchingBalance ? (
                <Loader2 className="w-3 h-3 animate-spin text-accent" />
            ) : (
                <span className="text-[11px] font-black tracking-wider text-foreground">
                    {parseFloat(balance).toFixed(2)} USDC
                </span>
            )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 mb-1">
          <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Recipient Wallet Address
          </label>
        </div>
        <div className="relative">
          <input
            type="text"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            className="input-elegant h-14 text-sm font-mono w-full pr-10"
            placeholder={isStellar ? "G..." : "0x..."}
            required
            autoComplete="off"
            spellCheck="false"
          />
          <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none">
            <Wallet className="w-4 h-4 text-muted-foreground/50" />
          </div>
        </div>
      </div>

      {isStellar && (
        <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Memo (optional)
            </label>
          </div>
          <div className="relative">
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="input-elegant h-14 text-sm w-full pr-10"
              placeholder="Memo text (max 28 chars)"
              maxLength={28}
              autoComplete="off"
            />
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Amount (USDC)
            </label>
          </div>
          <div className="flex flex-row gap-2 items-center">
            {parseFloat(balance) > 0 && (
              <button
                type="button"
                onClick={() => setAmount(balance)}
                className="px-3 py-1 rounded-lg bg-accent/10 text-accent text-[10px] font-black uppercase tracking-widest hover:bg-accent/20 transition-colors"
              >
                MAX
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xl font-black opacity-40">
            $
          </span>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input-elegant h-16 pl-10 text-3xl font-black tracking-tight text-right pr-4"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      <div className="space-y-4 pt-4">
        <button
          type="submit"
          disabled={loading || isSettingUpStellar || isZeroBalance || isOverBalance || !recipientAddress || isFetchingBalance}
          className="btn-primary w-full h-14 text-lg gap-3 shadow-xl hover:shadow-2xl transition-all disabled:opacity-50"
        >
          {loading || isSettingUpStellar ? (
            <Loader2 className="animate-spin" />
          ) : isZeroBalance ? (
            'Insufficient Funds'
          ) : isOverBalance ? (
            'Exceeds Balance'
          ) : (
            <>
              Send Crypto Now
              <ShieldCheck className="w-5 h-5 opacity-60" />
            </>
          )}
        </button>

        {status && (
          <div className="p-4 rounded-xl text-xs font-bold uppercase tracking-tight text-center break-words animate-in fade-in slide-in-from-top-2 duration-300 bg-muted/50 text-muted-foreground">
            {status}
          </div>
        )}
      </div>
    </form>
  );
}
