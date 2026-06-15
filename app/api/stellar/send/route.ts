/**
 * POST /api/stellar/send
 *
 * Sends USDC on Stellar from the authenticated user's Privy-managed wallet.
 * All transactions are fee-bumped by the sponsor — users never pay XLM fees.
 *
 * Body: { walletId, senderAddress, recipientAddress, amount, memo? }
 */

import {
  signStellarTransaction,
  submitStellarTransaction,
  buildFeeBumpTransaction,
} from '@/lib/stellar/privy-wallet';
import {
  buildUsdcPaymentTx,
  getStellarUsdcBalance,
  stellarAccountExists,
} from '@/lib/stellar/transactions';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { walletId, senderAddress, recipientAddress, amount, memo } =
      await req.json();

    if (!walletId || !senderAddress || !recipientAddress || !amount) {
      return NextResponse.json(
        { error: 'walletId, senderAddress, recipientAddress, and amount are required' },
        { status: 400 },
      );
    }

    if (!senderAddress.startsWith('G') || !recipientAddress.startsWith('G')) {
      return NextResponse.json(
        { error: 'Both addresses must be valid Stellar G-addresses' },
        { status: 400 },
      );
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // Balance check
    const usdcBalance = parseFloat(await getStellarUsdcBalance(senderAddress));
    if (usdcBalance < parsedAmount) {
      return NextResponse.json(
        { error: `Insufficient USDC balance. Available: ${usdcBalance.toFixed(2)} USDC` },
        { status: 400 },
      );
    }

    // Recipient must exist on-chain
    const recipientExists = await stellarAccountExists(recipientAddress);
    if (!recipientExists) {
      return NextResponse.json(
        { error: 'Recipient Stellar account is not yet activated (needs at least 1 XLM).' },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Send] ${senderAddress.slice(0, 6)} → ${recipientAddress.slice(0, 6)}, ${amount} USDC`);

    // Build unsigned payment transaction
    const { xdr: unsignedXdr } = await buildUsdcPaymentTx(
      senderAddress,
      recipientAddress,
      parsedAmount.toFixed(7),
      memo,
    );

    // Sign via Privy TEE
    const signedXdr = await signStellarTransaction(walletId, unsignedXdr, senderAddress);

    // Fee-bump — sponsor pays XLM fee, user pays nothing
    const feeBumpXdr = await buildFeeBumpTransaction(signedXdr, 1000);
    console.log('[Stellar/Send] Fee bump applied.');

    const result = await submitStellarTransaction(feeBumpXdr);
    console.log(`[Stellar/Send] Success: txHash=${result.hash}`);

    return NextResponse.json({ success: true, txHash: result.hash, feeBumped: true });
  } catch (error) {
    console.error('[Stellar/Send] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to send Stellar transaction' },
      { status: 500 },
    );
  }
}
