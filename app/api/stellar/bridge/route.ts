/**
 * POST /api/stellar/bridge
 *
 * Bridges USDC from a user's Privy TEE Stellar wallet to their Base smart account
 * via Circle CCTP V2 (Stellar domain 27 → Base domain 6).
 *
 * Flow:
 *   1. Check/set USDC allowance for TokenMessenger (approve if needed)
 *   2. Build depositForBurn Soroban transaction
 *   3. Sign both txs via Privy TEE rawSign
 *   4. Fee-bump both with sponsor (user pays zero XLM)
 *   5. Submit to Stellar Horizon
 *   6. Return burnTxHash → frontend polls /api/bridge/status?sourceChain=stellar
 *
 * Body: { walletId, senderAddress, recipientAddress, amount }
 *   walletId        — Privy wallet ID for the Stellar wallet
 *   senderAddress   — Stellar G... address
 *   recipientAddress — Base 0x... smart account address (CCTP mint destination)
 *   amount          — USDC amount as string e.g. "10.00"
 */

import {
  signStellarTransaction,
  submitStellarTransaction,
  buildFeeBumpTransaction,
} from '@/lib/stellar/privy-wallet';
import {
  buildStellarDepositForBurnTx,
  buildStellarApproveTx,
  calculateStellarMaxFee,
  getStellarUsdcAllowance,
  getStellarUsdcBalance,
  STELLAR_TOKEN_MESSENGER_CONTRACT,
} from '@/lib/circle/stellar-gateway';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { walletId, senderAddress, recipientAddress, amount, destChain } = await req.json() as {
      walletId: string;
      senderAddress: string;
      recipientAddress: string;
      amount: string;
      destChain?: string;
    };

    const finalDestChain = destChain || 'base';

    // ── Validation ─────────────────────────────────────────────────────────
    if (!walletId || !senderAddress || !recipientAddress || !amount) {
      return NextResponse.json(
        { error: 'walletId, senderAddress, recipientAddress, and amount are required' },
        { status: 400 },
      );
    }
    if (!senderAddress.startsWith('G')) {
      return NextResponse.json({ error: 'senderAddress must be a Stellar G-address' }, { status: 400 });
    }
    if (!recipientAddress.startsWith('0x')) {
      return NextResponse.json({ error: `recipientAddress must be an EVM 0x address` }, { status: 400 });
    }
    if (!STELLAR_TOKEN_MESSENGER_CONTRACT) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT is not configured' },
        { status: 500 },
      );
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    console.log(`[Stellar/Bridge] ${senderAddress.slice(0, 6)} → ${finalDestChain} ${recipientAddress.slice(0, 8)}, ${amount} USDC`);

    // ── Balance check ──────────────────────────────────────────────────────
    const usdcBalance = await getStellarUsdcBalance(senderAddress);
    if (usdcBalance < parsedAmount) {
      return NextResponse.json(
        { error: `Insufficient USDC balance. Available: ${usdcBalance.toFixed(2)} USDC` },
        { status: 400 },
      );
    }

    // ── Calculate CCTP max fee ─────────────────────────────────────────────
    console.log('[Stellar/Bridge] Calculating CCTP max fee...');
    const maxFeeSubunits = await calculateStellarMaxFee(amount, finalDestChain);
    console.log(`[Stellar/Bridge] Max fee subunits: ${maxFeeSubunits}`);

    // ── Step 1: Ensure USDC allowance for TokenMessenger ──────────────────
    // Check existing allowance (in 7-decimal Stellar subunits)
    const existingAllowance = await getStellarUsdcAllowance(
      senderAddress,
      STELLAR_TOKEN_MESSENGER_CONTRACT,
    );

    // Convert amount to 7-decimal subunits for comparison
    const [whole, frac = ''] = amount.split('.');
    const frac7 = (frac + '0000000').slice(0, 7);
    const amountSubunits = BigInt(whole + frac7);

    if (existingAllowance < amountSubunits + maxFeeSubunits) {
      console.log('[Stellar/Bridge] Allowance insufficient — building approve tx...');
      const { xdr: approveXdr } = await buildStellarApproveTx(
        senderAddress,
        STELLAR_TOKEN_MESSENGER_CONTRACT,
        amount,
      );

      console.log('[Stellar/Bridge] Signing approve tx via Privy TEE...');
      const signedApprove = await signStellarTransaction(walletId, approveXdr, senderAddress);

      const feeBumpApprove = await buildFeeBumpTransaction(signedApprove);
      const approveResult = await submitStellarTransaction(feeBumpApprove);
      console.log(`[Stellar/Bridge] ✓ Approve tx submitted: ${approveResult.hash}`);
    } else {
      console.log(`[Stellar/Bridge] Allowance sufficient (${existingAllowance}), skipping approve.`);
    }

    // ── Step 2: Build depositForBurn ───────────────────────────────────────
    console.log('[Stellar/Bridge] Building depositForBurn Soroban tx...');
    const { xdr: burnXdr } = await buildStellarDepositForBurnTx(
      senderAddress,
      recipientAddress,
      amount,
      maxFeeSubunits,
      finalDestChain,
    );

    // ── Step 3: Sign depositForBurn via Privy TEE ──────────────────────────
    console.log('[Stellar/Bridge] Signing depositForBurn via Privy TEE...');
    const signedBurn = await signStellarTransaction(walletId, burnXdr, senderAddress);

    // ── Step 4: Fee-bump and submit ────────────────────────────────────────
    const feeBumpBurn = await buildFeeBumpTransaction(signedBurn);
    console.log('[Stellar/Bridge] Fee bump applied. Submitting burn tx...');

    const burnResult = await submitStellarTransaction(feeBumpBurn);
    console.log(`[Stellar/Bridge] ✓ depositForBurn submitted: ${burnResult.hash}`);

    return NextResponse.json({
      success: true,
      burnTxHash: burnResult.hash,
    });
  } catch (error) {
    console.error('[Stellar/Bridge] Error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Stellar bridge failed' },
      { status: 500 },
    );
  }
}
