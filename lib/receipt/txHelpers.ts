import { AdminTransaction } from '@/types/admin';

/** Primary on-chain tx hash */
export function getTxHash(tx: AdminTransaction): string {
  if (tx.tx_type === 'bridge') return tx.burn_tx_hash || '—';
  if ('tx_hash' in tx) return (tx.tx_hash as string | null) || '—';
  return '—';
}

/** Secondary hash — bridge mint tx only */
export function getSecondaryHash(tx: AdminTransaction): string {
  if (tx.tx_type === 'bridge' && 'mint_tx_hash' in tx)
    return (tx.mint_tx_hash as string | null) || '—';
  return '—';
}

/** Human-readable chain / route label */
export function getChainInfo(tx: AdminTransaction): string {
  if (tx.tx_type === 'bridge')
    return `${tx.source_chain?.toUpperCase()} → ${tx.dest_chain?.toUpperCase()}`;
  if (tx.tx_type === 'deposit') return 'On-chain → USDC';
  if (tx.tx_type === 'withdrawal')
    return `USDC → ${'fiat_currency' in tx ? tx.fiat_currency : '—'}`;
  return 'USDC Transfer';
}
