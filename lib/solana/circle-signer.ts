/**
 * Our Solana fee payer's signature, from Circle's developer-controlled wallet.
 *
 * Through the SDK's own signer rather than a raw `signTransaction({ rawTransaction })` call,
 * because a claim is a v0 transaction now (see lib/solana/lookup-table) and the signer is what
 * serializes one correctly and puts the returned signature in the right slot. It signs by wallet
 * address and cluster, so no wallet id is needed here.
 */
import 'server-only';

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { createTransactionSigner } from '@circle-fin/developer-controlled-wallets/solana/web3';
import type { PublicKey, VersionedTransaction } from '@solana/web3.js';

import { NETWORK } from '@/lib/network';

/**
 * Add the fee payer's signature to `transaction`, in place, and return it.
 *
 * Throws when Circle refuses or answers without a signature; callers treat that as "nothing was
 * sent", which is true — our signature is what makes the transaction landable.
 */
export async function signWithCircleFeePayer(params: {
  apiKey: string;
  entitySecret: string;
  feePayer: PublicKey;
  transaction: VersionedTransaction;
}): Promise<VersionedTransaction> {
  const { apiKey, entitySecret, feePayer, transaction } = params;

  const signer = createTransactionSigner({
    client: initiateDeveloperControlledWalletsClient({ apiKey, entitySecret }),
    address: feePayer,
    chain: NETWORK.solana.circleBlockchain,
  });

  const signed = await signer.signTransaction(transaction);

  // `addSignature` leaves the slot zeroed if Circle answered with nothing usable, which would
  // broadcast as an invalid transaction rather than fail here.
  const slot = signed.message.staticAccountKeys.findIndex((k) => k.equals(feePayer));
  const signature = slot >= 0 ? signed.signatures[slot] : undefined;
  if (!signature || signature.every((b) => b === 0)) {
    throw new Error('Circle did not return a fee-payer signature for this Solana transaction.');
  }

  return signed;
}
