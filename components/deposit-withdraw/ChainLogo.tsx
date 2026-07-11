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
};

export function ChainLogo({ chain, size = 32 }: { chain: string; size?: number }) {
  const src = CHAIN_LOGOS[chain];
  if (!src) return null;

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
