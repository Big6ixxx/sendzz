import { base, baseSepolia } from 'viem/chains';

import { IS_TESTNET, NETWORK } from '../network';

/**
 * The app's home chain — where balances settle and transfers default to. Other chains are
 * reached explicitly via `SupportedChain`; this is only the default, not the whole world.
 */
export const chain = IS_TESTNET ? baseSepolia : base;

/** USDC on the home chain. Per-chain addresses live in `USDC_ADDRESSES`. */
export const USDC_ADDRESS = NETWORK.usdc.base;

export const CIRCLE_CLIENT_KEY = process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY;
export const CIRCLE_READ_URL = process.env.NEXT_PUBLIC_CIRCLE_READ_URL || '';
export const CIRCLE_SEND_URL = process.env.NEXT_PUBLIC_CIRCLE_SEND_URL || '';
