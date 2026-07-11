/**
 * deposit-shared
 *
 * Per-chain display metadata for deposit / activity UIs. (The legacy bridge-deposit
 * flow that lived here was replaced by ReceiveCryptoFlow + the Bridge page; only the
 * chain metadata remains, consumed by the transaction detail page.)
 */

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
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
  },
  base: {
    name: 'Base',
    color: '#0052FF',
    bg: 'rgba(0,82,255,0.08)',
    border: 'rgba(0,82,255,0.2)',
    description: 'Coinbase L2',
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
