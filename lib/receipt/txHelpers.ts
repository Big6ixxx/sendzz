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

/** `" (base)"`, or nothing when the row has no chain recorded — 4 of 540 withdrawals don't. */
function chainSuffix(chain: string | null | undefined): string {
  return chain ? ` (${chain.toLowerCase()})` : '';
}

/**
 * Human-readable chain / route label.
 *
 * Every row names the chain its USDC leg sits on, because "USDC → NGN" is the same string
 * whether it settled on Base or Stellar, and which one it was is usually the first thing you
 * need when a payout goes wrong.
 */
export function getChainInfo(tx: AdminTransaction): string {
  if (tx.tx_type === 'bridge')
    return `${tx.source_chain?.toUpperCase()} → ${tx.dest_chain?.toUpperCase()}`;
  if (tx.tx_type === 'deposit') {
    // Two different things share the `deposit` type, and labelling both "On-chain → USDC" hid
    // the difference: an on-ramp is fiat bought with a bank transfer, an on-chain deposit is
    // USDC that simply arrived. They fail in unrelated ways — a stalled on-ramp means an unpaid
    // provider order, a stalled on-chain deposit means the scanner missed a transfer.
    //
    // `currency_fiat` is the discriminator, same rule the explore feed uses: set for every
    // on-ramp, null for every on-chain deposit, with no rows in between.
    const on = chainSuffix(tx.network);
    if (tx.currency_fiat) return `${tx.currency_fiat} → USDC${on}`;
    return `USDC${on}`;
  }
  if (tx.tx_type === 'withdrawal')
    return `USDC${chainSuffix(tx.source_chain)} → ${'fiat_currency' in tx ? tx.fiat_currency : '—'}`;
  return `USDC Transfer${chainSuffix(tx.source_chain)}`;
}

export function getChainInfoShareable(tx: AdminTransaction): string {
  if (tx.tx_type === 'deposit') {
    const on = chainSuffix(tx.network);
    if (tx.currency_fiat) return `Fiat → USDC${on}`;
    return `USDC${on}`;
  }
  if (tx.tx_type === 'withdrawal') return `USDC${chainSuffix(tx.source_chain)} → Fiat`;
  return getChainInfo(tx);
}
