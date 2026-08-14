/**
 * Has a CCTP burn already been delivered on Stellar?
 *
 * EVM destinations answer this directly — the MessageTransmitter exposes a used-nonce map, so
 * `isMessageDelivered` just reads it. Soroban gives us no equivalent read, so we ask the only
 * way the contract will answer: *simulate* the claim and read the failure.
 *
 * A simulation costs nothing and signs nothing — it never leaves the RPC node. If the message
 * has already been consumed the forwarder rejects it with an already-received/nonce-used
 * error, and that rejection is the proof of delivery we're after.
 *
 * Deliberately conservative: anything other than a recognised already-claimed error returns
 * false. A trustline problem, an unreachable RPC, or a contract error we don't recognise must
 * never be read as "delivered" — that would hide a transfer the user still needs to claim.
 */
import { Contract, Keypair, Networks, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

import { loadStellarAccount } from '@/lib/circle/stellar-gateway';

const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ||
  'https://soroban-rpc.mainnet.stellar.gateway.fm';
const STELLAR_CCTP_FORWARDER =
  process.env.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER ||
  'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T';
const STELLAR_NETWORK_PASSPHRASE = Networks.PUBLIC;

/** Soroban surfaces "this message is spent" in several wordings depending on the layer. */
function isAlreadyDeliveredError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    lower.includes('nonce already used') ||
    lower.includes('already received') ||
    lower.includes('already processed') ||
    lower.includes('already claimed') ||
    lower.includes('message already')
  );
}

export async function isStellarBurnDelivered(
  messageHex: string,
  attestationHex: string,
): Promise<boolean> {
  const sponsorSecret = process.env.STELLAR_SPONSOR_SECRET_KEY;
  if (!sponsorSecret || !messageHex || !attestationHex) return false;

  try {
    const strip = (h: string) => (h.startsWith('0x') ? h.slice(2) : h);
    const messageBytes = Buffer.from(strip(messageHex), 'hex');
    const attestationBytes = Buffer.from(strip(attestationHex), 'hex');

    const server = new SorobanRpc.Server(STELLAR_RPC_URL);
    const sponsorAddress = Keypair.fromSecret(sponsorSecret).publicKey();
    const account = await loadStellarAccount(sponsorAddress);

    const tx = new TransactionBuilder(account, {
      fee: '100000',
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(STELLAR_CCTP_FORWARDER).call(
          'mint_and_forward',
          xdr.ScVal.scvBytes(messageBytes),
          xdr.ScVal.scvBytes(attestationBytes),
        ),
      )
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);

    // Simulation succeeded → the message is still claimable, so it has NOT been delivered.
    if (!SorobanRpc.Api.isSimulationError(sim)) return false;

    return isAlreadyDeliveredError(sim.error);
  } catch (err) {
    console.error(
      '[isStellarBurnDelivered] Simulation failed:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
