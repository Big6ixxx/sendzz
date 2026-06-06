'use client';

/**
 * UsdcDepositFlow — Chain dispatcher
 *
 * Renders the chain-select step, then delegates to one of three fully-isolated sub-flows:
 *   StellarDepositFlow  — Stellar CCTP V2 (Freighter wallet)
 *   SolanaDepositFlow   — Solana CCTP V2 (Phantom / Backpack / Solflare)
 *   EvmDepositFlow      — EVM CCTP V2 (arbitrum, ethereum, optimism, polygon, avalanche, base-direct)
 *
 * The sub-flows share NO state. Changing one sub-flow cannot affect another.
 *
 * This file only handles chain selection. All bridge logic lives in the sub-flows.
 */

import { useState } from 'react';
import { DepositChainSelectStep } from './DepositChainSelectStep';
import { StellarDepositFlow } from './StellarDepositFlow';
import { SolanaDepositFlow } from './SolanaDepositFlow';
import { EvmDepositFlow } from './EvmDepositFlow';
import { type FlowChain } from './deposit-shared';

export { BRIDGE_MIN_USDC } from './deposit-shared';

// ─── Component ────────────────────────────────────────────────────────────────

interface UsdcDepositFlowProps {
  userAddress: string;
  handleClose: () => void;
}

export function UsdcDepositFlow({ userAddress, handleClose }: UsdcDepositFlowProps) {
  const [chain, setChain] = useState<FlowChain | null>(null);

  const handleBack = () => setChain(null);

  if (!chain) {
    return (
      <DepositChainSelectStep
        onSelect={(c) => setChain(c)}
      />
    );
  }

  if (chain === 'stellar') {
    return (
      <StellarDepositFlow
        userAddress={userAddress}
        handleClose={handleClose}
        onBack={handleBack}
      />
    );
  }

  if (chain === 'solana') {
    return (
      <SolanaDepositFlow
        userAddress={userAddress}
        handleClose={handleClose}
        onBack={handleBack}
      />
    );
  }

  // All remaining chains are EVM (arbitrum, ethereum, optimism, polygon, avalanche, base-direct)
  return (
    <EvmDepositFlow
      chain={chain}
      userAddress={userAddress}
      handleClose={handleClose}
      onBack={handleBack}
    />
  );
}
