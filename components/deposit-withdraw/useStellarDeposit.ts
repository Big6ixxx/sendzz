'use client';

/**
 * useStellarDeposit
 *
 * Encapsulates all Stellar wallet (Freighter) state and bridge execution for
 * the UsdcDepositFlow. Dynamically imports Freighter and stellar-sdk so they
 * are never bundled server-side.
 */

import {
  buildStellarApproveTx,
  buildStellarDepositForBurnTx,
  calculateStellarMaxFee,
  getStellarUsdcAllowance,
  getStellarUsdcBalance,
  loadStellarAccount,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
  STELLAR_TOKEN_MESSENGER_CONTRACT,
} from '@/lib/circle/stellar-gateway';
import { useEffect, useState } from 'react';

// Lazy singleton so the module is imported only once per page
let freighterModule: typeof import('@stellar/freighter-api') | null = null;
async function getFreighter() {
  if (!freighterModule) {
    freighterModule = await import('@stellar/freighter-api');
  }
  return freighterModule;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StellarBridgeParams {
  /** Human-readable USDC amount to bridge */
  amount: string;
  /** Destination Base EVM address */
  userAddress: string;
  onStatusUpdate: (msg: string) => void;
  /** Called once the on-chain hash is known, before attestation polling starts */
  onBurnTxHash: (hash: string) => void;
}

export interface UseStellarDepositResult {
  address: string;
  balance: number | null;
  balanceLoading: boolean;
  isConnecting: boolean;
  freighterMissing: boolean;
  error: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  checkBalance: () => Promise<number>;
  executeBridge: (params: StellarBridgeParams) => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useStellarDeposit(): UseStellarDepositResult {
  const [address, setAddress] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [freighterMissing, setFreighterMissing] = useState(false);
  const [error, setError] = useState('');

  // Re-connect automatically if Freighter was already approved
  useEffect(() => {
    (async () => {
      try {
        const fw = await getFreighter();
        const { isConnected } = await fw.isConnected();
        if (isConnected) {
          const { address: addr, error: addrErr } = await fw.getAddress();
          if (!addrErr && addr) setAddress(addr);
        }
      } catch {
        // Freighter not installed — silent
      }
    })();
  }, []);

  // Refresh balance whenever the address changes
  useEffect(() => {
    if (!address) { setBalance(null); return; }
    setBalanceLoading(true);
    getStellarUsdcBalance(address)
      .then(setBalance)
      .catch(() => setBalance(null))
      .finally(() => setBalanceLoading(false));
  }, [address]);

  const connect = async () => {
    setIsConnecting(true);
    setError('');
    setFreighterMissing(false);
    try {
      const fw = await getFreighter();
      const { isConnected } = await fw.isConnected();
      if (!isConnected) {
        setFreighterMissing(true);
        return;
      }
      const { address: addr, error: reqErr } = await fw.requestAccess();
      if (reqErr) throw new Error(reqErr);
      if (!addr) throw new Error('No address returned by Freighter');
      setAddress(addr);
    } catch (err) {
      console.error('[useStellarDeposit] connect error:', err);
      setError('Could not connect Freighter. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const refreshBalance = async () => {
    if (!address) return;
    setBalanceLoading(true);
    try {
      setBalance(await getStellarUsdcBalance(address));
    } catch {
      // ignore transient errors
    } finally {
      setBalanceLoading(false);
    }
  };

  const checkBalance = async (): Promise<number> => {
    if (!address) return 0;
    return getStellarUsdcBalance(address);
  };

  const disconnect = () => {
    setAddress('');
    setBalance(null);
    setError('');
    setFreighterMissing(false);
  };

  const executeBridge = async (params: StellarBridgeParams) => {
    if (!address) throw new Error('No Stellar wallet connected');

    const fw = await getFreighter();
    params.onStatusUpdate('Checking USDC allowance…');

    const [whole, frac = ''] = params.amount.split('.');
    const frac7 = (frac + '0000000').slice(0, 7);
    const amountSubunits = BigInt(whole + frac7);

    const allowance = await getStellarUsdcAllowance(address, STELLAR_TOKEN_MESSENGER_CONTRACT);
    console.log('[useStellarDeposit] allowance =', allowance.toString(), '| required =', amountSubunits.toString());

    params.onStatusUpdate('Loading Stellar account…');
    const account = await loadStellarAccount(address);

    if (allowance < amountSubunits) {
      params.onStatusUpdate('Approving USDC transfer…');
      const { xdr: approveXdr } = await buildStellarApproveTx(
        address,
        STELLAR_TOKEN_MESSENGER_CONTRACT,
        params.amount,
        account,
      );

      params.onStatusUpdate('Requesting approval signature…');
      const { signedTxXdr: signedApproveXdr, error: approveSignErr } = await fw.signTransaction(approveXdr, {
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      });
      if (approveSignErr) throw new Error(approveSignErr);
      if (!signedApproveXdr) throw new Error('Freighter returned no signed XDR for approval');

      params.onStatusUpdate('Submitting approval to Stellar…');
      const { rpc: SorobanRpc, TransactionBuilder } = await import('@stellar/stellar-sdk');
      const server = new SorobanRpc.Server(STELLAR_RPC_URL);
      const parsedApprove = TransactionBuilder.fromXDR(signedApproveXdr, STELLAR_NETWORK_PASSPHRASE);
      const sendApproveResult = await server.sendTransaction(
        parsedApprove as Parameters<typeof server.sendTransaction>[0],
      );

      if (sendApproveResult.status === 'ERROR') {
        throw new Error(
          `Stellar approval failed: ${sendApproveResult.errorResult?.toXDR('base64') ?? 'unknown'}`,
        );
      }

      params.onStatusUpdate('Waiting for approval confirmation…');
      let status: string = sendApproveResult.status;
      let txResult;
      let attempts = 0;
      while ((status === 'PENDING' || status === 'NOT_FOUND') && attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        txResult = await server.getTransaction(sendApproveResult.hash);
        status = txResult.status;
        attempts++;
      }
      if (status !== 'SUCCESS') {
        throw new Error(`Stellar approval transaction failed with status ${status}`);
      }
      params.onStatusUpdate('Approval confirmed!');
    }

    params.onStatusUpdate('Calculating bridge fee…');
    const maxFeeSubunits = await calculateStellarMaxFee(params.amount);

    params.onStatusUpdate('Building Soroban transaction…');
    const { xdr } = await buildStellarDepositForBurnTx(
      address,
      params.userAddress,
      params.amount,
      maxFeeSubunits,
      account,
    );

    params.onStatusUpdate('Requesting Freighter signature…');
    const { signedTxXdr, error: signErr } = await fw.signTransaction(xdr, {
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    });
    if (signErr) throw new Error(signErr);
    if (!signedTxXdr) throw new Error('Freighter returned no signed XDR');

    params.onStatusUpdate('Submitting to Stellar network…');
    const { rpc: SorobanRpc, TransactionBuilder } = await import('@stellar/stellar-sdk');
    const server = new SorobanRpc.Server(STELLAR_RPC_URL);
    const parsed = TransactionBuilder.fromXDR(signedTxXdr, STELLAR_NETWORK_PASSPHRASE);
    const sendResult = await server.sendTransaction(
      parsed as Parameters<typeof server.sendTransaction>[0],
    );

    if (sendResult.status === 'ERROR') {
      throw new Error(
        `Stellar transaction failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown'}`,
      );
    }

    params.onStatusUpdate('Waiting for transaction confirmation…');
    let status: string = sendResult.status;
    let txResult;
    let attempts = 0;
    while ((status === 'PENDING' || status === 'NOT_FOUND') && attempts < 30) {
      await new Promise((r) => setTimeout(r, 2000));
      txResult = await server.getTransaction(sendResult.hash);
      status = txResult.status;
      attempts++;
    }
    if (status !== 'SUCCESS') {
      throw new Error(`Stellar bridge transaction failed with status ${status}`);
    }

    params.onBurnTxHash(sendResult.hash);
  };

  return {
    address,
    balance,
    balanceLoading,
    isConnecting,
    freighterMissing,
    error,
    connect,
    disconnect,
    refreshBalance,
    checkBalance,
    executeBridge,
  };
}
