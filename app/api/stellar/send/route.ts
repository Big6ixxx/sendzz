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
import { getVerifiedIdentity } from '@/lib/auth/session';
import {
  AuthorizationError,
  consumeAuthorization,
} from '@/lib/security/transaction-auth';
import {
  signStellarTransaction,
  submitStellarTransaction,
  buildFeeBumpTransaction,
  stellarTxHash,
} from '@/lib/stellar/privy-wallet';
import { clearPendingSend, markSendPending } from '@/lib/supabase/pendingSends';
import { supabaseAdmin } from '@/lib/supabase/adminClient';
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
      authorization,
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

    // ── PIN authorisation ───────────────────────────────────────────────────
    //
    // This is one of the places the server genuinely holds the pen: it builds the envelope,
    // asks Privy's TEE to sign it, and broadcasts. So the PIN is enforced here rather than
    // merely recorded — without a token bound to THIS recipient and THIS amount, nothing is
    // signed at all.
    //
    // The parameters hashed below are the ones this route is about to act on, not a summary
    // handed over by the caller. A payload taken from the request body would authorise
    // whatever the caller claimed to be doing, which is not a check.
    //
    // Withdrawals are exempt because they already spent a `withdrawal` authorisation when the
    // order was created — `withdrawalOrderId` is only ever set by that path, and asking for a
    // second PIN mid-settlement would strand a payout whose order already exists.
    if (!withdrawalOrderId) {
      try {
        await consumeAuthorization({
          token: authorization,
          purpose: 'crypto_transfer',
          payload: {
            destination: recipientAddress,
            amount: parsedAmount,
            chain: 'stellar',
          },
        });
      } catch (err) {
        const message =
          err instanceof AuthorizationError
            ? err.message
            : 'Could not verify your PIN. Please try again.';
        return NextResponse.json({ error: message }, { status: 401 });
      }
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
        console.error('[Stellar/Send] No fee treasury configured — set FEE_TREASURY_STELLAR');
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

    // Write the intent down BEFORE broadcasting, against the hash this envelope will have.
    //
    // Everything after this line can fail — Horizon can time out, this request can be killed
    // mid-flight, the user can close the tab — and the send is still recoverable, because the
    // reconciler can ask the chain about a hash we already committed to. Withdrawals are skipped:
    // they are recorded against their order, not as peer transfers.
    //
    // Only for P2P sends, and only when we know who is asking.
    const plannedHash = stellarTxHash(feeBumpXdr);
    if (!withdrawalOrderId) {
      const identity = await getVerifiedIdentity();
      if (identity) {
        const { data: sender } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', identity.email)
          .maybeSingle();
        if (sender?.id) {
          await markSendPending({
            userId: sender.id,
            txHash: plannedHash,
            chain: 'stellar',
            senderEmail: identity.email,
            recipient: recipientAddress,
            amount: parsedAmount,
            note: memo || 'Crypto transfer on Stellar',
          });
        }
      }
    }

    const result = await submitStellarTransaction(feeBumpXdr);

    // Broadcast, but not yet in a ledger. The envelope stays valid for its full timebound, so
    // this may still land and MUST NOT be reported as a failed send — that is precisely what
    // made a real 39 USDC transfer vanish: the user was shown an error, saw the balance drop,
    // and was one tap away from sending it twice.
    //
    // Nothing is recorded here on purpose. Only the chain knows whether this landed, so the
    // reconciler records it once the chain says so, rather than writing a row for a payment
    // that might never have happened.
    if (result.status === 'unresolved') {
      console.warn(`[Stellar/Send] Unresolved: txHash=${result.hash}`);
      return NextResponse.json(
        {
          success: false,
          pending: true,
          txHash: result.hash,
          error: 'Still confirming on Stellar. Your funds are safe — do not send again.',
        },
        { status: 202 },
      );
    }

    // In a ledger and rejected there. The transfer definitively did not happen, so this is the
    // one branch where telling the user it failed is the truth — and the intent is dropped,
    // because there is nothing for the reconciler to recover.
    if (!result.successful) {
      console.error(`[Stellar/Send] Rejected on-chain: txHash=${result.hash}`);
      await clearPendingSend(plannedHash);
      return NextResponse.json(
        { error: 'The network rejected this transfer. Nothing was sent.' },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Send] Success: txHash=${result.hash}`);

    // The intent is deliberately NOT cleared here, even though the send succeeded.
    //
    // The browser still has to write the ledger row, and it can die before it does — a closed
    // tab, a dropped connection. Leaving the intent means the reconciler covers that gap too:
    // it finds the row already recorded and simply drops the intent, or records it if the
    // browser never did. Clearing it now would reopen the window this whole mechanism exists
    // to close. Cost of leaving it: one extra row for up to one cron cycle.

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
