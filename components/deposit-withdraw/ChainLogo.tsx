'use client';

import Image from 'next/image';

const CHAIN_LOGOS: Record<string, string> = {
  arbitrum:     '/chains/arbitrum.png',
  ethereum:     '/chains/ethereum.png',
  optimism:     '/chains/optimism.png',
  polygon:      '/chains/polygon.png',
  avalanche:    '/chains/avalanche.png',
  solana:       '/chains/solana.png',
  stellar:      '/chains/stellar.png',
  base:          '/chains/base.png',
  'base-direct': '/chains/base.png',
  // No `arc` entry on purpose: there is no /chains/arc.png in public/, and naming a file
  // that doesn't exist renders a broken image rather than nothing. Arc falls through to
  // the initials badge below until real artwork is added here.
};

export function ChainLogo({ chain, size = 32 }: { chain: string; size?: number }) {
  const src = CHAIN_LOGOS[chain];
  if (!src) {
    return (
      <div
        className="rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs"
        style={{ width: size, height: size }}
      >
        {chain.slice(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={chain}
      width={size}
      height={size}
      className="rounded-full"
      style={{ width: size, height: size, objectFit: 'cover' }}
    />
  );
}
