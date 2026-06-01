'use client';

import { truncateAddress } from '@/lib/utils';
import { Copy, Send } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { BackHeader, type ChainMeta, type FlowChain } from './deposit-shared';

interface DepositAddressStepProps {
  chain: FlowChain;
  meta: ChainMeta;
  depositAddress: string;
  amount: string;
  onSentIt: () => void;
  onBack: () => void;
  onCopy: () => void;
}

export function DepositAddressStep({
  chain,
  meta,
  depositAddress,
  amount,
  onSentIt,
  onBack,
  onCopy,
}: DepositAddressStepProps) {
  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400">
      <BackHeader chain={chain} onBack={onBack} subtitle={`Send on ${meta.name}`} />

      {/* Instruction banner */}
      <div
        className="px-4 py-3 rounded-2xl text-center"
        style={{ background: meta.bg, border: `1px solid ${meta.border}` }}
      >
        <p className="text-sm font-bold" style={{ color: meta.color }}>
          Send {amount ? `$${parseFloat(amount).toLocaleString()} ` : ''}USDC to this address
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: 'rgba(248,248,246,0.4)' }}>
          Only send USDC on {meta.name}. Other tokens will be lost.
        </p>
      </div>

      {/* QR + Address */}
      <div
        className="p-5 rounded-3xl flex flex-col items-center space-y-4"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="p-3 bg-white rounded-2xl shadow-lg">
          <QRCodeSVG value={depositAddress} size={160} level="M" fgColor="#07070a" bgColor="#ffffff" />
        </div>
        <div className="w-full text-center space-y-2">
          <p className="text-sm font-mono font-medium break-all leading-relaxed" style={{ color: '#f8f8f6' }}>
            {truncateAddress(depositAddress, 12, 8)}
          </p>
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 mx-auto text-xs font-bold uppercase tracking-widest py-2 px-4 rounded-xl transition-all hover:opacity-80"
            style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}
          >
            <Copy className="w-3.5 h-3.5" />
            Copy Full Address
          </button>
        </div>
      </div>

      {/* Network warning */}
      <div
        className="flex items-start gap-2.5 p-3 rounded-xl"
        style={{ background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.15)' }}
      >
        <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: '#fb923c' }} />
        <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(251,146,60,0.9)' }}>
          <strong>Important:</strong> Only send USDC on the {meta.name} network to this address.
          Sending other tokens or using the wrong network will result in permanent loss.
        </p>
      </div>

      {/* CTAs */}
      <div className="space-y-2.5">
        <button
          onClick={onSentIt}
          className="w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          style={{ background: meta.color, color: '#fff' }}
        >
          <Send className="w-4 h-4" />
          I&apos;ve sent it
        </button>
        <button
          onClick={onCopy}
          className="w-full py-3 rounded-2xl font-bold text-sm transition-all"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(248,248,246,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          Copy Address Only
        </button>
      </div>
    </div>
  );
}
