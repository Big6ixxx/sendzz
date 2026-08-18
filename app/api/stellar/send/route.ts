/**
 * POST /api/stellar/send
 *
 * Sends USDC on Stellar from the authenticated user's Privy-managed wallet.
 * All transactions are fee-bumped by the sponsor — users never pay XLM fees.
 *
 * Body: { walletId, senderAddress, recipientAddress, amount, memo?, feeAmount? }
 *
 * `feeAmount` is for callers that have already priced their fee (withdrawals carry it on the
 * order). Omitted for P2P sends, which are priced at the transfer rate.
 */

import { getFeeTreasury, resolvePlatformFee } from '@/lib/fees/platform-fees';
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
    const {
      walletId,
      senderAddress,
      recipientAddress,
      amount,
      memo,
      feeAmount,
      withdrawalOrderId,
    } = await req.json();

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

    // Platform fee, paid in the same transaction. Fails closed: if Stellar has no treasury
    // configured we refuse rather than send fee-free.
    const platformFeeUsdc = resolvePlatformFee(parsedAmount, 'transfer', feeAmount);

    let platformFee: { usdc: string; treasury: string } | undefined;
    if (platformFeeUsdc > 0) {
      const treasury = getFeeTreasury('stellar');
      if (!treasury) {
        console.error('[Stellar/Send] No fee treasury configured — set BITNOB_FEE_TREASURY_STELLAR');
        return NextResponse.json(
          { error: 'Sending on Stellar is unavailable right now. Please try another network.' },
          { status: 503 },
        );
      }
      platformFee = { usdc: platformFeeUsdc.toFixed(7), treasury };
    }

    // The fee is a second operation out of the same balance, so the earlier check on `amount`
    // alone is not enough to know the transaction will go through.
    if (usdcBalance + 1e-9 < parsedAmount + platformFeeUsdc) {
      console.error('[Stellar/Send] balance does not cover amount + platform fee');
      return NextResponse.json({ error: 'Insufficient USDC balance.' }, { status: 400 });
    }

    // Build unsigned payment transaction
    const { xdr: unsignedXdr } = await buildUsdcPaymentTx(
      senderAddress,
      recipientAddress,
      parsedAmount.toFixed(7),
      memo,
      platformFee,
    );

    // Sign via Privy TEE
    const signedXdr = await signStellarTransaction(walletId, unsignedXdr, senderAddress);

    // Fee-bump — sponsor pays XLM fee, user pays nothing
    const feeBumpXdr = await buildFeeBumpTransaction(signedXdr);
    console.log('[Stellar/Send] Fee bump applied.');

    const result = await submitStellarTransaction(feeBumpXdr);
    console.log(`[Stellar/Send] Success: txHash=${result.hash}`);

    // Record the hash against its withdrawal HERE, not from the browser.
    //
    // On this chain the deposit can only be tied to a payout by its hash, and the payout is
    // created after the deposit clears. If the tab closes in between, a browser-written hash is
    // lost and the deposit becomes unattributable — money in, nothing to finish it with. Writing
    // it server-side, in the same call that broadcast the transfer, closes that window: the
    // reconcile cron always has the hash it needs.
    if (withdrawalOrderId && result.hash) {
      try {
        const { saveWithdrawalTxHash } = await import('@/lib/supabase/transactions');
        await saveWithdrawalTxHash(withdrawalOrderId, result.hash);
      } catch (e) {
        console.error(`[Stellar/Send] Could not record tx hash for ${withdrawalOrderId}:`, e);
      }
    }

    return NextResponse.json({ success: true, txHash: result.hash, feeBumped: true });
  } catch (error) {
    console.error('[Stellar/Send] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to send Stellar transaction' },
      { status: 500 },
    );
  }
}
