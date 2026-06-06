'use client';

/**
 * deposit-shared
 *
 * Shared types, constants, and UI primitives for the USDC deposit flow.
 * Imported by all step components and UsdcDepositFlow.
 */

import { SOURCE_CHAINS, type SupportedChain } from '@/lib/circle/gateway';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { ChainLogo } from './ChainLogo';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FlowChain = SupportedChain | 'solana' | 'stellar' | 'base-direct';

export interface ChainMeta {
  name: string;
  color: string;
  bg: string;
  border: string;
  description: string;
  isDirect?: boolean;
  explorerTx: (hash: string) => string;
}

export interface WalletConfig {
  label: string;
  description: string;
  onConnect: () => void;
  isConnecting: boolean;
  warning: { text: string; link: { href: string; label: string } | null } | null;
  error: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const CHAIN_META: Record<string, ChainMeta> = {
  'base-direct': {
    name: 'Base',
    color: '#0052FF',
    bg: 'rgba(0,82,255,0.08)',
    border: 'rgba(0,82,255,0.2)',
    description: 'Direct · No bridge',
    isDirect: true,
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
  arbitrum: {
    name: 'Arbitrum',
    color: '#28A0F0',
    bg: 'rgba(40,160,240,0.08)',
    border: 'rgba(40,160,240,0.2)',
    description: 'Fast & low-fee',
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
  },
  ethereum: {
    name: 'Ethereum',
    color: '#627EEA',
    bg: 'rgba(98,126,234,0.08)',
    border: 'rgba(98,126,234,0.2)',
    description: 'Most widely used',
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
  },
  optimism: {
    name: 'Optimism',
    color: '#FF0420',
    bg: 'rgba(255,4,32,0.08)',
    border: 'rgba(255,4,32,0.2)',
    description: 'Superchain L2',
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
  },
  polygon: {
    name: 'Polygon',
    color: '#8247E5',
    bg: 'rgba(130,71,229,0.08)',
    border: 'rgba(130,71,229,0.2)',
    description: 'Low-cost EVM',
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
  },
  avalanche: {
    name: 'Avalanche',
    color: '#E84142',
    bg: 'rgba(232,65,66,0.08)',
    border: 'rgba(232,65,66,0.2)',
    description: 'High-speed L1',
    explorerTx: (h) => `https://snowtrace.io/tx/${h}`,
  },
  solana: {
    name: 'Solana',
    color: '#9945FF',
    bg: 'rgba(153,69,255,0.08)',
    border: 'rgba(153,69,255,0.2)',
    description: 'Ultra-fast L1',
    explorerTx: (h) => `https://solscan.io/tx/${h}`,
  },
  stellar: {
    name: 'Stellar',
    color: '#08B5E5',
    bg: 'rgba(8,181,229,0.08)',
    border: 'rgba(8,181,229,0.2)',
    description: 'Stellar network',
    explorerTx: (h) => `https://stellar.expert/explorer/public/tx/${h}`,
  },
};

export const ALL_CHAINS: FlowChain[] = ['base-direct', ...SOURCE_CHAINS, 'solana', 'stellar'];

// Circle CCTP V2 fees are percentage-based (bps). As of 2026-05:
//   Arbitrum/Optimism → Base: 1.3 bps; Ethereum/Solana → Base: 1.0 bps
//   Avalanche/Polygon/Stellar → Base: 0 bps (free fast transfer)
// No protocol-level minimum exists — 1 USDC is the practical UX floor.
export const BRIDGE_MIN_USDC: Record<string, number> = {
  arbitrum: 1,
  ethereum: 1,
  optimism: 1,
  polygon: 1,
  avalanche: 1,
  solana: 1,
  stellar: 1,
  'base-direct': 0.01,
};

// ─── Shared UI components ─────────────────────────────────────────────────────

/** Rounded chain logo badge using brand SVG logos. */
export function ChainBadge({ chain, size = 40 }: { chain: string; size?: number }) {
  return <ChainLogo chain={chain} size={size} />;
}

interface BackHeaderProps {
  chain: FlowChain;
  onBack: () => void;
  subtitle?: string;
}

export function BackHeader({ chain, onBack, subtitle }: BackHeaderProps) {
  const meta = CHAIN_META[chain];
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="p-2 rounded-xl hover:bg-white/5 transition-colors text-white/40 hover:text-white/80"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2.5">
        <ChainBadge chain={chain} size={32} />
        <div>
          <p className="text-sm font-bold text-white">{meta.name}</p>
          {subtitle && (
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface BridgingMonitorProps {
  chain: FlowChain;
  monitorMsg: string;
  burnTxHash: string;
}

export function BridgingMonitor({ chain, monitorMsg, burnTxHash }: BridgingMonitorProps) {
  const meta = CHAIN_META[chain];
  return (
    <div className="flex flex-col items-center py-8 space-y-6 text-center animate-in fade-in duration-400">
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{ background: meta.bg, border: `2px solid ${meta.border}` }}
      >
        <Loader2 className="w-10 h-10 animate-spin" style={{ color: meta.color }} />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-display font-bold text-white">Bridging to Base</h3>
        <p className="text-sm max-w-xs" style={{ color: 'rgba(248,248,246,0.4)' }}>
          Circle&apos;s relayer is processing your transfer. This could take up to 15–20 minutes.
        </p>
      </div>
      <div
        className="w-full p-4 rounded-2xl"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'rgba(248,248,246,0.35)' }}>
          {monitorMsg}
        </p>
      </div>
      {burnTxHash && (
        <a
          href={meta.explorerTx(burnTxHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'rgba(248,248,246,0.25)' }}
        >
          <ExternalLink className="w-3 h-3" />
          View source transaction
        </a>
      )}
      <p className="text-[10px]" style={{ color: 'rgba(248,248,246,0.15)' }}>
        You can safely close this window — your USDC will arrive automatically.
      </p>
    </div>
  );
}

interface BridgeSuccessProps {
  bridgeAmt: string;
  mintTxHash: string;
  isDirect: boolean;
  onClose: () => void;
}

export function BridgeSuccess({ bridgeAmt, mintTxHash, isDirect, onClose }: BridgeSuccessProps) {
  return (
    <div className="flex flex-col items-center py-8 space-y-6 text-center animate-in zoom-in-95 duration-500">
      <div
        className="w-24 h-24 rounded-full flex items-center justify-center shadow-2xl"
        style={{ background: '#00e87a', color: '#07070a', boxShadow: '0 16px 48px rgba(0,232,122,0.35)' }}
      >
        <CheckCircle2 className="w-12 h-12" />
      </div>
      <div className="space-y-2">
        <h3 className="text-2xl font-display font-bold text-white">
          {isDirect ? 'Deposit Address Ready' : 'Bridge Complete!'}
        </h3>
        <p className="text-sm" style={{ color: 'rgba(248,248,246,0.5)' }}>
          {isDirect
            ? 'Your Base address is ready to receive USDC.'
            : `${bridgeAmt} USDC is on its way to your Base wallet.`}
        </p>
      </div>
      {mintTxHash && (
        <a
          href={`https://basescan.org/tx/${mintTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all hover:opacity-80"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(248,248,246,0.6)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View on BaseScan
        </a>
      )}
      <button
        onClick={onClose}
        className="w-full py-4 rounded-2xl font-bold text-sm"
        style={{ background: '#00e87a', color: '#07070a' }}
      >
        Back to Dashboard
      </button>
    </div>
  );
}
