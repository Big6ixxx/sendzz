/**
 * POST /api/stellar/claim
 *
 * Claims a CCTP transfer whose destination is Stellar by calling `mint_and_forward`
 * on the Soroban forwarder. The sponsor pays the fee, so the user needs no XLM.
 *
 * The forwarder mints USDC and then *transfers* it to the recipient's G-address.
 * That transfer fails with Error(Contract, #13) — "trustline entry is missing for
 * account" — if the recipient has no USDC trustline, which leaves the funds burned
 * but unminted. So when the caller supplies the wallet, we repair the trustline
 * before simulating, and retry once if simulation still trips over it.
 *
 * Body: { txHash, sourceChain, walletId?, stellarAddress? }
 */

import { NextResponse } from 'next/server';
import { Keypair, TransactionBuilder, Contract, xdr, Networks } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { loadStellarAccount } from '@/lib/circle/stellar-gateway';
import { ensureStellarUsdcReceivable } from '@/lib/stellar/privy-wallet';
import { isAlreadyDeliveredError } from '@/lib/stellar/delivery';
import { CCTP_DOMAINS } from '@/lib/circle/gateway';

const STELLAR_RPC_URL = process.env.NEXT_PUBLIC_STELLAR_RPC_URL || 'https://soroban-rpc.mainnet.stellar.gateway.fm';
const STELLAR_CCTP_FORWARDER = 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T';
const STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;

/** Soroban surfaces the missing-trustline case as a host error, not a typed code. */
function isTrustlineError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return lower.includes('trustline') || lower.includes('trust line');
}

/** Never leak Soroban diagnostics, XDR, or contract addresses to the client. */
function safeClaimError(raw: string): { error: string; code: string } {
  if (isTrustlineError(raw)) {
    return {
      error:
        "Your Stellar account isn't set up to receive USDC yet. We've started the setup — please retry the claim in a moment.",
      code: 'trustline_missing',
    };
  }
  // Shared with the pending-claims panel: Soroban reports a spent nonce as a bare numeric
  // contract error, so matching only on English text reported every already-claimed transfer
  // as a generic failure and left its Claim button on screen forever.
  if (isAlreadyDeliveredError(raw)) {
    return { error: 'This transfer has already been claimed.', code: 'already_claimed' };
  }
  const lower = raw.toLowerCase();
  if (lower.includes('insufficient') || lower.includes('sponsor')) {
    return {
      error: 'Claims are temporarily unavailable. Your funds are safe — please try again shortly.',
      code: 'sponsor_unavailable',
    };
  }
  return {
    error: "We couldn't complete the claim right now. Your funds are safe — please try again shortly.",
    code: 'claim_failed',
  };
}

export async function POST(req: Request) {
  try {
    const { txHash, sourceChain, walletId, stellarAddress } = await req.json() as {
      txHash: string;
      sourceChain: string;
      walletId?: string;
      stellarAddress?: string;
    };

    if (!txHash || !sourceChain) {
      return NextResponse.json(
        { error: 'txHash and sourceChain are required' },
        { status: 400 },
      );
    }

    const domain = CCTP_DOMAINS[sourceChain as keyof typeof CCTP_DOMAINS];
    if (domain === undefined) {
      return NextResponse.json(
        { error: `Unsupported source chain: ${sourceChain}` },
        { status: 400 },
      );
    }

    console.log(`[Stellar/Claim] Claiming CCTP tx: ${txHash} from domain ${domain} to Stellar...`);

    // 0. Make sure the recipient can actually hold USDC before we spend a fee on it.
    if (walletId && stellarAddress) {
      const receivable = await ensureStellarUsdcReceivable(walletId, stellarAddress);
      if (!receivable.ready) {
        console.error(`[Stellar/Claim] Recipient not receivable (${receivable.reason}):`, receivable.detail);
        return NextResponse.json(
          {
            error:
              receivable.reason === 'signer_not_granted'
                ? 'Your Stellar wallet still needs to authorise this app. Reload the bridge page, then claim again.'
                : "We're still setting up your Stellar account to receive USDC. Your funds are safe — please retry the claim in a moment.",
            code: receivable.reason,
          },
          { status: 409 },
        );
      }
    }

    // 1. Fetch attestation from Iris API
    const irisRes = await fetch(`https://iris-api.circle.com/v2/messages/${domain}?transactionHash=${txHash}`);
    if (!irisRes.ok) {
      throw new Error(`Iris API query failed: ${irisRes.statusText}`);
    }
    interface IrisResponse {
      messages?: Array<{
        message: string;
        attestation: string;
        status: string;
      }>;
    }
    const irisData = (await irisRes.json()) as IrisResponse;
    if (!irisData.messages || irisData.messages.length === 0) {
      return NextResponse.json(
        {
          error: 'Circle is still verifying this transfer. Please try again in 1–2 minutes.',
          code: 'attestation_pending',
        },
        { status: 409 },
      );
    }

    const { message, attestation, status } = irisData.messages[0];
    if (status !== 'complete') {
      return NextResponse.json(
        {
          error: 'Circle is still verifying this transfer. Please try again in 1–2 minutes.',
          code: 'attestation_pending',
        },
        { status: 409 },
      );
    }

    const messageBytes = Buffer.from(message.startsWith('0x') ? message.slice(2) : message, 'hex');
    const attestationBytes = Buffer.from(attestation.startsWith('0x') ? attestation.slice(2) : attestation, 'hex');

    // 2. Setup Sponsor Keypair
    const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET_KEY;
    if (!sponsorSecret) {
      throw new Error('STELLAR_SPONSOR_SECRET_KEY is not configured on the server');
    }
    const sponsorKeypair = Keypair.fromSecret(sponsorSecret);
    const sponsorAddress = sponsorKeypair.publicKey();

    const server = new SorobanRpc.Server(STELLAR_RPC_URL);

    /** Build + simulate `mint_and_forward`. Returns the assembled tx or the sim error. */
    const buildAndSimulate = async () => {
      const txAccount = await loadStellarAccount(sponsorAddress);
      const contract = new Contract(STELLAR_CCTP_FORWARDER);
      const tx = new TransactionBuilder(txAccount, {
        fee: '100000', // start with high fee limit, simulation will update it
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            'mint_and_forward',
            xdr.ScVal.scvBytes(messageBytes),
            xdr.ScVal.scvBytes(attestationBytes)
          )
        )
        .setTimeout(120)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (SorobanRpc.Api.isSimulationError(sim)) {
        return { ok: false as const, error: sim.error };
      }
      return { ok: true as const, tx: SorobanRpc.assembleTransaction(tx, sim).build() };
    };

    // 3. Simulate — repairing the trustline once if that's what's blocking us.
    console.log('[Stellar/Claim] Loading sponsor account and simulating on Soroban RPC...');
    let simulated = await buildAndSimulate();

    if (!simulated.ok && isTrustlineError(simulated.error) && walletId && stellarAddress) {
      console.warn('[Stellar/Claim] Simulation hit a missing trustline — repairing and retrying once.');
      const repaired = await ensureStellarUsdcReceivable(walletId, stellarAddress);
      if (repaired.ready) {
        simulated = await buildAndSimulate();
      }
    }

    if (!simulated.ok) {
      console.error('[Stellar/Claim] Soroban simulation failed:', simulated.error);
      const safe = safeClaimError(simulated.error);
      return NextResponse.json(safe, { status: safe.code === 'already_claimed' ? 409 : 502 });
    }

    const preppedTx = simulated.tx;

    // 4. Sign transaction
    preppedTx.sign(sponsorKeypair);

    // 5. Submit to Soroban RPC
    console.log('[Stellar/Claim] Submitting transaction to Soroban RPC...');
    const submitResult = await server.sendTransaction(preppedTx);

    if (submitResult.status === 'ERROR') {
      const errInfo = submitResult as unknown as { errorResultXdr?: string; errorResult?: string };
      console.error('[Stellar/Claim] Soroban send failed:', errInfo.errorResultXdr || errInfo.errorResult);
      return NextResponse.json(safeClaimError('send failed'), { status: 502 });
    }

    const stellarTxHash = submitResult.hash;
    console.log('[Stellar/Claim] Transaction submitted. Hash:', stellarTxHash);

    // 6. Poll for result
    console.log('[Stellar/Claim] Polling for execution result...');
    let attempts = 0;
    while (attempts < 10) {
      attempts++;
      const statusResult = await server.getTransaction(stellarTxHash);
      if (statusResult.status === 'SUCCESS') {
        console.log(`[Stellar/Claim] ✓ Claim transaction successful: ${stellarTxHash}`);
        return NextResponse.json({ success: true, txHash: stellarTxHash });
      } else if (statusResult.status === 'FAILED') {
        console.error('[Stellar/Claim] On-chain failure:', statusResult.resultXdr);
        return NextResponse.json(safeClaimError('execution failed'), { status: 502 });
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    // If timeout, return the tx hash anyway
    return NextResponse.json({ success: true, txHash: stellarTxHash, pending: true });
  } catch (error) {
    console.error('[Stellar/Claim] Error claiming transaction:', error);
    return NextResponse.json(
      safeClaimError(error instanceof Error ? error.message : String(error)),
      { status: 500 },
    );
  }
}
