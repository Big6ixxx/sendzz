import {
  toCircleSmartAccount,
  toModularTransport,
} from '@circle-fin/modular-wallets-core';
import { EIP1193Provider } from '@privy-io/react-auth';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { createBundlerClient } from 'viem/account-abstraction';
import {
  chain as defaultChain,
  CIRCLE_CLIENT_KEY,
  CIRCLE_SEND_URL as CIRCLE_CLIENT_URL,
} from './config';
import { VIEM_CHAINS } from './multichain';
import { SupportedChain } from '../circle/gateway';

// Per-chain public RPC URLs for gas estimation
const CHAIN_RPC_URLS: Record<string, string | undefined> = {
  base: process.env.NEXT_PUBLIC_RPC_URL,
  arbitrum: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
  avalanche: process.env.NEXT_PUBLIC_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc',
  ethereum: process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL || 'https://cloudflare-eth.com',
};

const getCircleRpcUrl = (chainName: string = 'base') => `${CIRCLE_CLIENT_URL}/${chainName}`;

// Build a viem custom account from Privy's provider
// Privy supports eth_signTypedData_v4 but NOT raw signing
function privyToLocalAccount(provider: EIP1193Provider, address: Address) {
  return {
    address,
    type: 'local' as const,

    // Privy supports signTypedData via eth_signTypedData_v4
    async signTypedData(typedData: unknown): Promise<Hex> {
      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, JSON.stringify(typedData)],
      });
      return signature as Hex;
    },

    // Required by viem account interface but won't be called for permit flow
    async signMessage({
      message,
    }: {
      message: string | { raw: string };
    }): Promise<Hex> {
      const signature = await provider.request({
        method: 'personal_sign',
        params: [typeof message === 'string' ? message : message.raw, address],
      });
      return signature as Hex;
    },

    // Not supported by Privy embedded wallets — throw a clear error
    async sign(): Promise<never> {
      throw new Error('Raw sign not supported by Privy embedded wallets.');
    },
  };
}

export async function getCircleClient(provider: EIP1193Provider, targetChain: string = 'base') {
  if (!CIRCLE_CLIENT_KEY) throw new Error('Circle Client Key not configured.');
  if (!CIRCLE_CLIENT_URL) throw new Error('Circle Client URL not configured.');

  const chainObj = VIEM_CHAINS[targetChain as SupportedChain] ?? defaultChain;
  
  const modularTransport = toModularTransport(
    getCircleRpcUrl(targetChain),
    CIRCLE_CLIENT_KEY,
  );

  const publicClient = createPublicClient({
    chain: chainObj,
    transport: http(CHAIN_RPC_URLS[targetChain] || undefined), // Use chain-specific RPC for accurate gas estimation
  });

  // Get the EOA address from Privy
  const [address]: [Address] = await provider.request({
    method: 'eth_requestAccounts',
  });

  // Use our custom Privy-compatible local account instead of walletClientToLocalAccount
  const localAccount = privyToLocalAccount(provider, address);

  const account = await toCircleSmartAccount({
    client: publicClient,
    owner: localAccount,
  });

  // Circle's modularTransport handles the Paymaster and Gas Station natively across all supported chains
  const bundlerClient = createBundlerClient({
    chain: chainObj,
    transport: modularTransport,
    account,
  });

  return { bundlerClient, account, localAccount };
}

export async function getCircleAddress(provider: EIP1193Provider, targetChain: string = 'base') {
  if (!CIRCLE_CLIENT_KEY) throw new Error('Circle Client Key not configured.');

  const chainObj = VIEM_CHAINS[targetChain as SupportedChain] ?? defaultChain;

  const publicClient = createPublicClient({
    chain: chainObj,
    transport: http(
      `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
    ),
  });

  const [address]: [Address] = await provider.request({
    method: 'eth_requestAccounts',
  });

  const localAccount = privyToLocalAccount(provider, address);

  const account = await toCircleSmartAccount({
    client: publicClient,
    owner: localAccount,
  });

  return account.address;
}

/**
 * Deterministically computes a Circle Smart Account address from any EOA address.
 * Useful for pre-generating wallets without needing a true signer.
 */
export async function computeCircleSmartAddress(eoaAddress: string) {
  const publicClient = createPublicClient({
    chain: defaultChain,
    transport: http(
      `https://base-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_API_KEY}`,
    ),
  });

  // Mock owner that satisfies the owner interface purely for address derivation
  const mockOwner = {
    address: eoaAddress as Address,
    type: 'local' as const,
    signTypedData: async () => '0x' as Hex,
    signMessage: async () => '0x' as Hex,
    sign: async () => {
      throw new Error('Cannot sign with mock owner');
    },
  };

  const account = await toCircleSmartAccount({
    client: publicClient,
    owner: mockOwner,
  });

  return account.address;
}
