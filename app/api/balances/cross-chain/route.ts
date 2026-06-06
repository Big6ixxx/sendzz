import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, fallback, type Chain } from 'viem';
import { mainnet, arbitrum, avalanche, optimism, polygon, base } from 'viem/chains';
import { USDC_ADDRESSES, SOURCE_CHAINS, type SupportedChain } from '@/lib/circle/gateway';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Solana USDC mint (mainnet)
const SOLANA_USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Reliable public RPC fallbacks — always available, no rate limits
const PUBLIC_RPCS: Record<SupportedChain, string> = {
  arbitrum:  'https://arb1.arbitrum.io/rpc',
  avalanche: 'https://api.avax.network/ext/bc/C/rpc',
  ethereum:  'https://cloudflare-eth.com',
  optimism:  'https://mainnet.optimism.io',
  polygon:   'https://polygon-rpc.com',
  base:      'https://mainnet.base.org',
};

// On the server (API routes), NEXT_PUBLIC_ vars ARE available in process.env,
// but we prefer the private SOLANA_RPC_URL if set. Fall back in order:
// 1. SOLANA_RPC_URL (private, server-only)
// 2. NEXT_PUBLIC_SOLANA_RPC_URL (public, set in .env)
// 3. Public fallback (often 403s from browsers but fine server-side)
const SOLANA_RPC =
  process.env.SOLANA_RPC_URL ??
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  'https://api.mainnet-beta.solana.com';

function makeClient(chain: Chain, alchemyUrl?: string, publicUrl?: string) {
  const transports = [
    ...(alchemyUrl ? [http(alchemyUrl, { timeout: 8000, retryCount: 1 })] : []),
    ...(publicUrl  ? [http(publicUrl,  { timeout: 10000, retryCount: 2 })] : []),
  ];
  return createPublicClient({
    chain,
    // fallback() tries each transport in order, moving to the next on any error (incl. 429)
    transport: transports.length > 1 ? fallback(transports) : transports[0],
  });
}

function getEvmClients(): Record<SupportedChain, ReturnType<typeof createPublicClient>> {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || '';
  const alchemy = (subdomain: string) =>
    key ? `https://${subdomain}.g.alchemy.com/v2/${key}` : undefined;

  return {
    ethereum:  makeClient(mainnet,   process.env.ETHEREUM_RPC_URL  || alchemy('eth-mainnet'),     PUBLIC_RPCS.ethereum),
    arbitrum:  makeClient(arbitrum,  process.env.ARBITRUM_RPC_URL  || alchemy('arb-mainnet'),     PUBLIC_RPCS.arbitrum),
    avalanche: makeClient(avalanche, process.env.AVALANCHE_RPC_URL || alchemy('avax-mainnet'),    PUBLIC_RPCS.avalanche),
    optimism:  makeClient(optimism,  process.env.OPTIMISM_RPC_URL  || alchemy('opt-mainnet'),     PUBLIC_RPCS.optimism),
    polygon:   makeClient(polygon,   process.env.POLYGON_RPC_URL   || alchemy('polygon-mainnet'), PUBLIC_RPCS.polygon),
    base:      makeClient(base,      process.env.NEXT_PUBLIC_RPC_URL,                             PUBLIC_RPCS.base),
  };
}

/** Fetch Solana USDC balance for a given base58 wallet address. Returns 0 on any error. */
async function getSolanaUsdcBalance(walletAddress: string): Promise<number> {
  try {
    const connection = new Connection(SOLANA_RPC, 'confirmed');
    const walletPubkey = new PublicKey(walletAddress);
    const ata = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, walletPubkey);
    const info = await connection.getTokenAccountBalance(ata);
    return Number(info.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

/** Validate a Solana base58 public key string. */
function isValidSolanaAddress(addr: string): boolean {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  const solanaAddress = req.nextUrl.searchParams.get('solanaAddress');

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'Invalid EVM address' }, { status: 400 });
  }

  const clients = getEvmClients();

  // Scan all EVM source chains in parallel
  const evmPromises = SOURCE_CHAINS.map(async (chain) => {
    try {
      const client = clients[chain];
      const usdcAddress = USDC_ADDRESSES[chain];

      const balance = await client.readContract({
        address: usdcAddress as `0x${string}`,
        abi: BALANCE_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      });

      const formatted = (Number(balance) / 1_000_000).toString();
      return { chain, balance: formatted, hasBalance: Number(balance) > 0 };
    } catch {
      return { chain, balance: '0', hasBalance: false };
    }
  });

  // Scan Solana if address provided and valid
  const solanaPromise = (solanaAddress && isValidSolanaAddress(solanaAddress))
    ? (async () => {
        const bal = await getSolanaUsdcBalance(solanaAddress);
        return {
          chain: 'solana' as const,
          balance: bal.toString(),
          hasBalance: bal > 0,
        };
      })()
    : Promise.resolve(null);

  const [evmResults, solanaResult] = await Promise.all([
    Promise.all(evmPromises),
    solanaPromise,
  ]);

  const results = [
    ...evmResults.filter((r) => r.hasBalance),
    ...(solanaResult?.hasBalance ? [solanaResult] : []),
  ];

  return NextResponse.json(results);
}
