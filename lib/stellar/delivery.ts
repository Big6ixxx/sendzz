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

/**
 * Contract error codes that mean "this message has already been consumed".
 *
 * Soroban does not return prose. A spent nonce comes back as `Error(Contract, #6908)` and
 * nothing else — no wording to match, which is why a text-only test never fired and every
 * already-claimed Stellar transfer looked like a fresh failure.
 *
 * 6908 was confirmed against the chain, not inferred: for burn 0x37f92ed9 (1 USDC, Base to
 * Stellar) the simulation returns #6908 while Stellar transaction d99d0ca9…6f93 successfully
 * consumed that exact CCTP nonce. Same for 0xdaf16029 (0.03 USDC) and da7ffe2c…5f90.
 *
 * Only codes verified that way belong here. An unrecognised code must stay unrecognised —
 * guessing that some other failure means "delivered" would hide USDC the user still owns.
 */
const ALREADY_DELIVERED_CONTRACT_CODES = new Set([6908]);

/**
 * Does this simulation failure mean the message was already delivered?
 *
 * Shared with the claim route so the panel and the button can never disagree about what an
 * error means — one saying "already claimed" while the other says "something went wrong" is
 * how a delivered transfer kept its Claim button.
 */
export function isAlreadyDeliveredError(raw: string): boolean {
  const code = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (code && ALREADY_DELIVERED_CONTRACT_CODES.has(Number(code[1]))) return true;

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
