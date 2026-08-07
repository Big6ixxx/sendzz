/**
 * deposit-shared
 *
 * Per-chain display metadata for deposit / activity UIs. (The legacy bridge-deposit
 * flow that lived here was replaced by ReceiveCryptoFlow + the Bridge page; only the
 * chain metadata remains, consumed by the transaction detail page.)
 *
 * Explorer URLs come from `lib/explorers.ts`; only display metadata lives here.
 */
import { explorerTxUrl } from '@/lib/explorers';

export interface ChainMeta {
  name: string;
  color: string;
  bg: string;
  border: string;
  description: string;
  isDirect?: boolean;
  explorerTx: (hash: string) => string;
}

export const CHAIN_META: Record<string, ChainMeta> = {
  'base-direct': {
    name: 'Base',
    color: '#0052FF',
    bg: 'rgba(0,82,255,0.08)',
    border: 'rgba(0,82,255,0.2)',
    description: 'Direct · No bridge',
    isDirect: true,
    explorerTx: (h) => explorerTxUrl('base', h) ?? '',
  },
  base: {
    name: 'Base',
    color: '#0052FF',
    bg: 'rgba(0,82,255,0.08)',
    border: 'rgba(0,82,255,0.2)',
    description: 'Coinbase L2',
    explorerTx: (h) => explorerTxUrl('base', h) ?? '',
  },
  arbitrum: {
    name: 'Arbitrum',
    color: '#28A0F0',
    bg: 'rgba(40,160,240,0.08)',
    border: 'rgba(40,160,240,0.2)',
    description: 'Fast & low-fee',
    explorerTx: (h) => explorerTxUrl('arbitrum', h) ?? '',
  },
  ethereum: {
    name: 'Ethereum',
    color: '#627EEA',
    bg: 'rgba(98,126,234,0.08)',
    border: 'rgba(98,126,234,0.2)',
    description: 'Most widely used',
    explorerTx: (h) => explorerTxUrl('ethereum', h) ?? '',
  },
  optimism: {
    name: 'Optimism',
    color: '#FF0420',
    bg: 'rgba(255,4,32,0.08)',
    border: 'rgba(255,4,32,0.2)',
    description: 'Superchain L2',
    explorerTx: (h) => explorerTxUrl('optimism', h) ?? '',
  },
  polygon: {
    name: 'Polygon',
    color: '#8247E5',
    bg: 'rgba(130,71,229,0.08)',
    border: 'rgba(130,71,229,0.2)',
    description: 'Low-cost EVM',
    explorerTx: (h) => explorerTxUrl('polygon', h) ?? '',
  },
  avalanche: {
    name: 'Avalanche',
    color: '#E84142',
    bg: 'rgba(232,65,66,0.08)',
    border: 'rgba(232,65,66,0.2)',
    description: 'High-speed L1',
    explorerTx: (h) => explorerTxUrl('avalanche', h) ?? '',
  },
  solana: {
    name: 'Solana',
    color: '#9945FF',
    bg: 'rgba(153,69,255,0.08)',
    border: 'rgba(153,69,255,0.2)',
    description: 'Ultra-fast L1',
    explorerTx: (h) => explorerTxUrl('solana', h) ?? '',
  },
  stellar: {
    name: 'Stellar',
    color: '#08B5E5',
    bg: 'rgba(8,181,229,0.08)',
    border: 'rgba(8,181,229,0.2)',
    description: 'Stellar network',
    explorerTx: (h) => explorerTxUrl('stellar', h) ?? '',
  },
  arc: {
    name: 'Arc Testnet',
    color: '#00e87a',
    bg: 'rgba(0,232,122,0.08)',
    border: 'rgba(0,232,122,0.2)',
    description: 'Circle USDC L1',
    explorerTx: (h) => explorerTxUrl('arc', h) ?? '',
  },
};
