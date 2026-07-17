/**
 * Smart Routing engine (Phase 2).
 *
 * Pure functions that decide which chain(s) a payment should be sourced from, given
 * the sender's per-chain USDC balances. The guiding rules (see docs/multichain-plan.md
 * §4.3):
 *
 *   1. No-bridge first — if a single chain covers the whole amount, use it.
 *   2. Prefer the home chain, then low-fee chains (gas is sponsored, so this is about
 *      keeping funds on fast/cheap rails and avoiding fragmentation).
 *   3. Multi-source before bridging — if the balance is split, pay from several chains.
 *   4. Consolidation (CCTP) is out of scope here; callers surface "needs consolidation".
 *
 * All math is done in integer micro-USDC (6 decimals) to avoid floating-point dust.
 */

import { type SupportedChain } from '../circle/gateway';

/** The EVM chains a Circle smart account can transact on (shared CREATE2 address). */
export const EVM_CHAINS: SupportedChain[] = [
  'base',
  'polygon',
  'arbitrum',
  'optimism',
  'avalanche',
  'ethereum',
];

/**
 * Spend preference, cheapest/fastest first. Ethereum L1 is last (highest real cost
 * even when gas is sponsored, and slowest finality). The home chain is hoisted to the
 * front by the planner.
 */
const SPEND_PRIORITY: SupportedChain[] = [
  'base',
  'polygon',
  'arbitrum',
  'optimism',
  'avalanche',
  'ethereum',
];

export type ChainBalances = Partial<Record<SupportedChain, number>>;

/**
 * How the user wants funds sourced for a money movement.
 *  - `auto`        — let the router decide (default; "money, not chains").
 *  - `single`      — spend entirely from one chosen chain (must hold enough).
 *  - `consolidate` — gather from exactly these chains (CCTP → settlement chain) first.
 * `solana` is allowed in the `consolidate` list; the executor bridges it via Base.
 */
export type SourceChainKey = SupportedChain | 'solana' | 'stellar';
export type SourcePreference =
  | { mode: 'auto' }
  | { mode: 'single'; chain: SourceChainKey }
  | { mode: 'consolidate'; from: SourceChainKey[] };

export const AUTO_SOURCE: SourcePreference = { mode: 'auto' };

/**
 * Solana as a spendable source. Solana can't be transacted on directly by the EVM
 * routing, so it's pulled in by bridging to Base; `bridgeToBase` performs that hop.
 */
export interface SolanaSource {
  balance: number;
  bridgeToBase: (
    amount: string,
    recipient: string,
    onStatus?: (status: string) => void,
  ) => Promise<void>;
  /**
   * Settle an off-ramp directly on Solana: send the payout USDC to the provider's Solana
   * deposit address and (optionally) the platform fee to a treasury address, in one sponsored
   * SPL transaction. Returns the transaction signature. Present only when a Solana wallet is
   * connected.
   */
  settleOffRamp?: (params: {
    payoutAddress: string;
    payoutAmount: string;
    feeAddress?: string;
    feeAmount?: string;
    onStatus?: (status: string) => void;
  }) => Promise<string>;
}

/** Chains the fiat on/off-ramp can settle USDC on (source + destination). */
export const RAMP_NETWORKS: SupportedChain[] = ['base', 'polygon', 'ethereum'];

export interface RouteLeg {
  chain: SupportedChain;
  /** Decimal USDC string, e.g. "12.5". */
  amount: string;
}

export interface RoutePlan {
  feasible: boolean;
  legs: RouteLeg[];
  /** Sum of all EVM balances considered, in USDC. */
  totalAvailable: number;
  requested: number;
  /** True when funds must be pulled from more than one chain. */
  multiSource: boolean;
}

// ── micro-USDC helpers ────────────────────────────────────────────────────────

const MICRO = 1_000_000;
const toMicro = (usdc: number): bigint => BigInt(Math.round((usdc || 0) * MICRO));

/** Format integer micro-USDC back to a trimmed decimal string. */
function microToStr(micro: bigint): string {
  const neg = micro < 0n;
  const abs = neg ? -micro : micro;
  const whole = abs / BigInt(MICRO);
  const frac = (abs % BigInt(MICRO)).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Build the spend order with the home chain first. */
function spendOrder(homeChain: SupportedChain): SupportedChain[] {
  return [homeChain, ...SPEND_PRIORITY.filter((c) => c !== homeChain)];
}

// ── single-transfer routing ─────────────────────────────────────────────────

/**
 * Plan how to source `amountUsdc` for a single transfer from the sender's per-chain
 * balances. Because intra-platform recipients share one address across all EVM chains,
 * each leg is just a same-chain transfer — no bridge.
 */
export function planTransferRoute(
  amountUsdc: string,
  balances: ChainBalances,
  opts: { homeChain?: SupportedChain; source?: SourcePreference } = {},
): RoutePlan {
  const home = opts.homeChain ?? 'base';
  const order = spendOrder(home);

  const requestedMicro = toMicro(parseFloat(amountUsdc));
  const totalMicro = order.reduce((s, c) => s + toMicro(balances[c] ?? 0), 0n);
  const totalAvailable = Number(totalMicro) / MICRO;
  const requested = Number(requestedMicro) / MICRO;

  const infeasible = (): RoutePlan => ({
    feasible: false,
    legs: [],
    totalAvailable,
    requested,
    multiSource: false,
  });

  if (requestedMicro <= 0n) return infeasible();

  // User override: pay entirely from one chosen chain (only valid if it holds enough).
  if (opts.source?.mode === 'single') {
    const c = opts.source.chain;
    // Solana settlement isn't an EVM route — it's handled directly by the caller.
    if (c === 'solana') return infeasible();
    if (toMicro(balances[c] ?? 0) >= requestedMicro) {
      return {
        feasible: true,
        legs: [{ chain: c, amount: microToStr(requestedMicro) }],
        totalAvailable,
        requested,
        multiSource: false,
      };
    }
    return infeasible();
  }

  if (requestedMicro > totalMicro) return infeasible();

  // 1) Single chain that fully covers the amount (earliest in preference order).
  const single = order.find((c) => toMicro(balances[c] ?? 0) >= requestedMicro);
  if (single) {
    return {
      feasible: true,
      legs: [{ chain: single, amount: microToStr(requestedMicro) }],
      totalAvailable,
      requested,
      multiSource: false,
    };
  }

  // 2) Greedy multi-source across chains in preference order.
  const legs: RouteLeg[] = [];
  let remaining = requestedMicro;
  for (const c of order) {
    if (remaining <= 0n) break;
    const bal = toMicro(balances[c] ?? 0);
    if (bal <= 0n) continue;
    const take = bal < remaining ? bal : remaining;
    legs.push({ chain: c, amount: microToStr(take) });
    remaining -= take;
  }

  return {
    feasible: remaining <= 0n,
    legs,
    totalAvailable,
    requested,
    multiSource: legs.length > 1,
  };
}

// ── batch routing ─────────────────────────────────────────────────────────────

export interface BatchChainGroup {
  chain: SupportedChain;
  /** Number of recipients (each paid `amountEach`) assigned to this chain. */
  count: number;
}

export interface BatchRoutePlan {
  feasible: boolean;
  /**
   * True when total balance covers the payroll but it's fragmented such that no
   * single chain can fully pay a recipient with its leftover — needs consolidation
   * (Phase 4) before the batch can run.
   */
  needsConsolidation: boolean;
  groups: BatchChainGroup[];
  totalAvailable: number;
  requested: number;
}

/**
 * Plan a batch payout where every recipient receives `amountEach`. Each recipient is
 * paid wholly on one chain (so one batched UserOp per chain). Greedy bin-packing in
 * preference order; recipients are assigned in their original order so the caller can
 * slice the list directly.
 */
export function planBatchRoute(
  amountEach: string,
  recipientCount: number,
  balances: ChainBalances,
  opts: { homeChain?: SupportedChain } = {},
): BatchRoutePlan {
  const home = opts.homeChain ?? 'base';
  const order = spendOrder(home);

  const eachMicro = toMicro(parseFloat(amountEach));
  const totalMicro = order.reduce((s, c) => s + toMicro(balances[c] ?? 0), 0n);
  const totalAvailable = Number(totalMicro) / MICRO;
  const requested = (Number(eachMicro) / MICRO) * recipientCount;

  const base = { groups: [] as BatchChainGroup[], totalAvailable, requested };

  if (eachMicro <= 0n || recipientCount <= 0) {
    return { feasible: false, needsConsolidation: false, ...base };
  }
  if (eachMicro * BigInt(recipientCount) > totalMicro) {
    return { feasible: false, needsConsolidation: false, ...base };
  }

  // Greedy: each chain pays as many whole recipients as its balance allows.
  const groups: BatchChainGroup[] = [];
  let remaining = recipientCount;
  for (const c of order) {
    if (remaining <= 0) break;
    const capacity = Number(toMicro(balances[c] ?? 0) / eachMicro); // whole recipients
    if (capacity <= 0) continue;
    const count = Math.min(capacity, remaining);
    groups.push({ chain: c, count });
    remaining -= count;
  }

  if (remaining > 0) {
    // Total funds suffice, but per-chain leftovers are each smaller than one recipient.
    return { feasible: false, needsConsolidation: true, ...base, groups };
  }

  return { feasible: true, needsConsolidation: false, groups, totalAvailable, requested };
}

// ── external crypto-address send routing ───────────────────────────────────────

export interface ExternalSendPlan {
  /** 'direct' = same-chain transfer; 'bridge' = CCTP from sourceChain → destChain. */
  mode: 'direct' | 'bridge' | 'infeasible';
  destChain: SupportedChain;
  /** Set when mode === 'bridge': the chain to bridge the funds from. */
  sourceChain?: SupportedChain;
  needsConsolidation: boolean;
  totalAvailable: number;
  requested: number;
}

/**
 * Plan a send to an external address on `destChain`.
 *  - If the user already holds enough on `destChain` → a direct same-chain transfer.
 *  - Otherwise pick a single other chain that holds the full amount and bridge from it
 *    (CCTP delivers straight to the recipient on `destChain`).
 *  - If no single chain holds enough, it's infeasible (needsConsolidation when the
 *    overall balance would cover it but is fragmented).
 *
 * A bridge sources from one chain only — CCTP delivers to one recipient per burn, so we
 * don't split an external send across chains.
 */
export function planExternalSend(
  amountUsdc: string,
  destChain: SupportedChain,
  balances: ChainBalances,
  opts: { homeChain?: SupportedChain } = {},
): ExternalSendPlan {
  const home = opts.homeChain ?? 'base';
  const requestedMicro = toMicro(parseFloat(amountUsdc));
  const totalMicro = (Object.values(balances) as number[]).reduce(
    (s, n) => s + toMicro(n ?? 0),
    0n,
  );
  const totalAvailable = Number(totalMicro) / MICRO;
  const requested = Number(requestedMicro) / MICRO;

  if (requestedMicro <= 0n) {
    return { mode: 'infeasible', destChain, needsConsolidation: false, totalAvailable, requested };
  }

  // 1) Direct send if the destination chain already holds enough.
  if (toMicro(balances[destChain] ?? 0) >= requestedMicro) {
    return { mode: 'direct', destChain, needsConsolidation: false, totalAvailable, requested };
  }

  // 2) Bridge from a single other chain that holds the full amount (cheapest first).
  const sourceChain = spendOrder(home)
    .filter((c) => c !== destChain)
    .find((c) => toMicro(balances[c] ?? 0) >= requestedMicro);

  if (sourceChain) {
    return { mode: 'bridge', destChain, sourceChain, needsConsolidation: false, totalAvailable, requested };
  }

  // 3) No single chain covers it.
  return {
    mode: 'infeasible',
    destChain,
    needsConsolidation: requestedMicro <= totalMicro,
    totalAvailable,
    requested,
  };
}

// ── withdrawal (fiat off-ramp) routing ─────────────────────────────────────────

export interface WithdrawalRoutePlan {
  feasible: boolean;
  /** The single ramp-supported chain to send the USDC from. */
  chain?: SupportedChain;
  /**
   * True when the full balance covers the amount but it's spread across chains such
   * that no single ramp-supported chain holds enough — consolidation (Phase 4)
   * is required before the off-ramp can run.
   */
  needsConsolidation: boolean;
  /** When consolidating, the chains to pull from (honours a user override; else all). */
  consolidateFrom?: SourceChainKey[];
  totalAvailable: number;
  requested: number;
}

/**
 * Pick the single chain to source a fiat off-ramp from. A ramp order settles on
 * exactly one network, so (unlike p2p) we cannot multi-source — we choose one supported
 * chain that holds the full amount, preferring the home chain then cheaper rails.
 *
 * Honours a user `source` override: `single` forces a chosen supported chain (if it holds
 * enough), `consolidate` gathers the chosen chains onto the settlement chain first.
 */
export function planWithdrawalRoute(
  amountUsdc: string,
  balances: ChainBalances,
  opts: {
    supportedChains?: SupportedChain[];
    homeChain?: SupportedChain;
    source?: SourcePreference;
  } = {},
): WithdrawalRoutePlan {
  const supported = opts.supportedChains ?? RAMP_NETWORKS;
  const home = opts.homeChain ?? 'base';
  const settlement = supported.includes(home) ? home : supported[0] ?? 'base';
  const order = spendOrder(home).filter((c) => supported.includes(c));

  const requestedMicro = toMicro(parseFloat(amountUsdc));
  const totalMicro = (Object.values(balances) as number[]).reduce(
    (s, n) => s + toMicro(n ?? 0),
    0n,
  );
  const totalAvailable = Number(totalMicro) / MICRO;
  const requested = Number(requestedMicro) / MICRO;

  if (requestedMicro <= 0n) {
    return { feasible: false, needsConsolidation: false, totalAvailable, requested };
  }

  // User override: force a single supported chain (must hold enough and be ramp-supported).
  if (opts.source?.mode === 'single') {
    const c = opts.source.chain;
    // Solana settlement isn't an EVM route — the caller handles it directly.
    if (c === 'solana') {
      return { feasible: false, needsConsolidation: false, totalAvailable, requested };
    }
    if (supported.includes(c) && toMicro(balances[c] ?? 0) >= requestedMicro) {
      return { feasible: true, chain: c, needsConsolidation: false, totalAvailable, requested };
    }
    return { feasible: false, needsConsolidation: false, totalAvailable, requested };
  }

  // User override: consolidate the chosen chains onto the settlement chain.
  if (opts.source?.mode === 'consolidate') {
    return {
      feasible: false,
      needsConsolidation: true,
      consolidateFrom: opts.source.from,
      chain: settlement,
      totalAvailable,
      requested,
    };
  }

  const chain = order.find((c) => toMicro(balances[c] ?? 0) >= requestedMicro);
  if (chain) {
    return { feasible: true, chain, needsConsolidation: false, totalAvailable, requested };
  }

  // No single supported chain covers it. If the overall balance does, it's a
  // fragmentation problem that consolidation can fix.
  return {
    feasible: false,
    needsConsolidation: requestedMicro <= totalMicro,
    chain: settlement,
    totalAvailable,
    requested,
  };
}
