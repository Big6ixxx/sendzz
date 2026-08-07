import { USDC_ADDRESSES, type SupportedChain } from '../circle/gateway';
import { HOME_CHAIN } from '@/lib/explorers';
import { VIEM_CHAINS } from './multichain';

/**
 * The app's home chain — where balances settle and transfers default to. Other chains are
 * reached explicitly via `SupportedChain`; this is only the default, not the whole world.
 *
 * Derived from `HOME_CHAIN` rather than restated, so the chain object, its USDC address
 * and the explorer links can't drift apart the way they had (the home chain was Arc while
 * its USDC address pointed at an account with no code on Arc).
 */
export const chain = VIEM_CHAINS[HOME_CHAIN as SupportedChain];

/** USDC on the home chain. Per-chain addresses live in `USDC_ADDRESSES`. */
export const USDC_ADDRESS = USDC_ADDRESSES[HOME_CHAIN as SupportedChain];

export const CIRCLE_CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
export const CIRCLE_READ_URL = process.env.NEXT_PUBLIC_CIRCLE_READ_URL || '';
export const CIRCLE_SEND_URL = process.env.NEXT_PUBLIC_CIRCLE_SEND_URL || '';
