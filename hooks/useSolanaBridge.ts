'use client';

import { useMemo } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import { Connection, Transaction } from '@solana/web3.js';
import { bridgeSolanaToBase } from '@/lib/web3/solana-bridge';
import { settleSolanaOffRamp } from '@/lib/web3/solana-offramp';
import type { SolanaSource } from '@/lib/web3/routing';
import { NETWORK } from '@/lib/network';
import { solanaRpcUrl } from '@/lib/solana/rpc';
import { sendAndConfirmSigned } from '@/lib/solana/confirm';

/**
 * Provides the capability to bridge the user's Solana USDC onto an EVM chain (Base by default), wiring up the
 * Privy Solana signer + the embedded EVM wallet (needed to mint on Base). Returns
 * `bridgeToBase = null` when the user has no usable Solana wallet.
 */
export function useSolanaBridge(): {
  bridgeToBase: SolanaSource['bridgeToBase'] | null;
  settleOffRamp: SolanaSource['settleOffRamp'] | null;
} {
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const { wallets: solWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();

  const connection = useMemo(() => new Connection(solanaRpcUrl(), 'confirmed'), []);

  const evmWallet = wallets.find((w) => w.walletClientType === 'privy');

  const solAccount = user?.linkedAccounts.find(
    (a) =>
      a.type === 'wallet' &&
      (a as { walletClientType?: string }).walletClientType === 'privy' &&
      (a as { chainType?: string }).chainType === 'solana',
  );
  const solAddress =
    solAccount && 'address' in solAccount
      ? (solAccount as { address: string }).address
      : undefined;
  const solWallet = solWallets.find((w) => w.address === solAddress) ?? null;

  return useMemo(() => {
    if (!evmWallet || !solWallet || !solAddress) return { bridgeToBase: null, settleOffRamp: null };
    const conn = connection;

    // Sign with the Privy Solana wallet + broadcast, for the CCTP burn.
    const signAndBroadcast = async (tx: Transaction): Promise<string> => {
      const { signedTransaction } = await signTransaction({
        transaction: tx.serialize({ requireAllSignatures: false }),
        wallet: solWallet,
        chain: NETWORK.solana.privyCluster,
      });
      return sendAndConfirmSigned(conn, signedTransaction, tx.lastValidBlockHeight);
    };

    const bridgeToBase: SolanaSource['bridgeToBase'] = async (amount, recipient, onStatus, destChain) => {
      await bridgeSolanaToBase({
        connection: conn,
        walletAddress: solAddress,
        amount,
        recipientEvm: recipient,
        destChain,
        evmWallet,
        onStatus,
        signAndBroadcast,
      });
    };

    const settleOffRamp: SolanaSource['settleOffRamp'] = (p) =>
      settleSolanaOffRamp({
        connection: conn,
        walletAddress: solAddress,
        payoutAddress: p.payoutAddress,
        payoutAmount: p.payoutAmount,
        feeAddress: p.feeAddress,
        feeAmount: p.feeAmount,
        withdrawalOrderId: p.withdrawalOrderId,
        onStatus: p.onStatus,
        // Sign only: the server co-signs and broadcasts (lib/solana/sponsor).
        sign: async (tx) =>
          (
            await signTransaction({
              transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
              wallet: solWallet,
            })
          ).signedTransaction,
      });

    return { bridgeToBase, settleOffRamp };
  }, [evmWallet, solWallet, solAddress, signTransaction, connection]);
}
