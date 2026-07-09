'use client';

import { useMemo } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import { Connection, Transaction } from '@solana/web3.js';
import { bridgeSolanaToBase } from '@/lib/web3/solana-bridge';
import type { SolanaSource } from '@/lib/web3/routing';

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

/**
 * Provides the capability to bridge the user's Solana USDC onto Base, wiring up the
 * Privy Solana signer + the embedded EVM wallet (needed to mint on Base). Returns
 * `bridgeToBase = null` when the user has no usable Solana wallet.
 */
export function useSolanaBridge(): {
  bridgeToBase: SolanaSource['bridgeToBase'] | null;
} {
  const { wallets } = useWallets();
  const { user } = usePrivy();
  const { wallets: solWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();

  const connection = useMemo(() => new Connection(SOLANA_RPC, 'confirmed'), []);

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
    if (!evmWallet || !solWallet || !solAddress) return { bridgeToBase: null };
    const conn = connection;

    const bridgeToBase: SolanaSource['bridgeToBase'] = async (
      amount,
      recipient,
      onStatus,
    ) => {
      await bridgeSolanaToBase({
        connection: conn,
        walletAddress: solAddress,
        amount,
        recipientEvm: recipient,
        evmWallet,
        onStatus,
        signAndBroadcast: async (tx: Transaction) => {
          const { signedTransaction } = await signTransaction({
            transaction: tx.serialize({ requireAllSignatures: false }),
            wallet: solWallet,
          });
          const sig = await conn.sendRawTransaction(signedTransaction, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
          });
          const bh = await conn.getLatestBlockhash();
          await conn.confirmTransaction(
            {
              signature: sig,
              blockhash: bh.blockhash,
              lastValidBlockHeight: bh.lastValidBlockHeight,
            },
            'confirmed',
          );
          return sig;
        },
      });
    };

    return { bridgeToBase };
  }, [evmWallet, solWallet, solAddress, signTransaction, connection]);
}
