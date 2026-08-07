/**
 * Stellar network configuration — one source of truth for both networks.
 *
 * Every Stellar constant used to be read straight from an env var with a mainnet
 * fallback, spread across four files. That looked configurable but was really pinned:
 * `.env` sets the generic `NEXT_PUBLIC_STELLAR_*` variables to mainnet values, so a
 * testnet build still talked to mainnet Horizon with the mainnet USDC issuer, no matter
 * what NEXT_PUBLIC_SIMULATION_MODE said. `privy-wallet` was worse — its USDC issuer was
 * a hardcoded mainnet constant with no override at all.
 *
 * The override rule below is what makes the single switch actually work:
 *
 *   mainnet → the generic NEXT_PUBLIC_STELLAR_* variables apply (production is unchanged)
 *   testnet → only *_TESTNET-suffixed variables apply
 *
 * So the existing mainnet values in `.env` keep doing their job and cannot leak into a
 * testnet run. Same pattern as the Circle Gas Station policy IDs.
 */

import { Networks } from '@stellar/stellar-sdk';
import { IS_TESTNET } from '@/lib/web3/network';

export interface StellarNetworkConfig {
  horizonUrl: string;
  sorobanRpcUrl: string;
  networkPassphrase: string;
  /** Classic asset issuer for USDC — the G… account. */
  usdcIssuer: string;
  /** Soroban Stellar Asset Contract for that same USDC. */
  usdcContract: string;
  /** Circle CCTP TokenMessengerMinter (Soroban). Empty when not deployed on this network. */
  tokenMessengerContract: string;
  /** Circle CCTP mint-and-forward contract. Empty when not deployed on this network. */
  cctpForwarder: string;
  /** Circle CCTP MessageTransmitter (Soroban). */
  messageTransmitterContract: string;
}

/** Reads an override only when it belongs to the network currently selected. */
function override(generic: string | undefined, testnet: string | undefined): string | undefined {
  return IS_TESTNET ? testnet : generic;
}

const MAINNET: StellarNetworkConfig = {
  horizonUrl: 'https://horizon.stellar.org',
  sorobanRpcUrl: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
  networkPassphrase: Networks.PUBLIC,
  usdcIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  usdcContract: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
  // Circle's published Stellar mainnet CCTP deployment (domain 27).
  tokenMessengerContract: 'CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL',
  cctpForwarder: 'CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T',
  messageTransmitterContract: 'CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV',
};

const TESTNET: StellarNetworkConfig = {
  horizonUrl: 'https://horizon-testnet.stellar.org',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: Networks.TESTNET,
  // Circle's published testnet USDC issuer. Verified to resolve on testnet Horizon —
  // an issuer that fails Stellar's checksum turns every trustline into an error, and a
  // plausible-looking wrong address had already been committed here once.
  usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  // Derived as the canonical Stellar Asset Contract for USDC:<testnet issuer>. The same
  // derivation reproduces the mainnet contract above exactly, which is what makes this
  // trustworthy rather than guessed.
  usdcContract: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  // Circle's published Stellar testnet CCTP deployment (domain 27). All three verified
  // deployed on testnet Soroban, and Circle's sandbox Iris quotes fees for domain 27 in
  // both directions — so bridging to and from Stellar works on testnet, contrary to an
  // earlier assumption here that it was mainnet-only.
  tokenMessengerContract: 'CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP',
  cctpForwarder: 'CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ',
  messageTransmitterContract: 'CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY',
};

const base = IS_TESTNET ? TESTNET : MAINNET;

export const STELLAR: StellarNetworkConfig = {
  horizonUrl:
    override(
      process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
      process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL_TESTNET,
    ) || base.horizonUrl,
  sorobanRpcUrl:
    override(
      process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
      process.env.NEXT_PUBLIC_STELLAR_RPC_URL_TESTNET,
    ) || base.sorobanRpcUrl,
  networkPassphrase:
    override(
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
      process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE_TESTNET,
    ) || base.networkPassphrase,
  usdcIssuer:
    override(
      process.env.NEXT_PUBLIC_STELLAR_USDC_ISSUER,
      process.env.NEXT_PUBLIC_STELLAR_USDC_ISSUER_TESTNET,
    ) || base.usdcIssuer,
  usdcContract:
    override(
      process.env.NEXT_PUBLIC_STELLAR_USDC_CONTRACT,
      process.env.NEXT_PUBLIC_STELLAR_USDC_CONTRACT_TESTNET,
    ) || base.usdcContract,
  tokenMessengerContract:
    override(
      process.env.NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT,
      process.env.NEXT_PUBLIC_STELLAR_TOKEN_MESSENGER_CONTRACT_TESTNET,
    ) || base.tokenMessengerContract,
  cctpForwarder:
    override(
      process.env.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER,
      process.env.NEXT_PUBLIC_STELLAR_CCTP_FORWARDER_TESTNET,
    ) || base.cctpForwarder,
  messageTransmitterContract:
    override(
      process.env.NEXT_PUBLIC_STELLAR_MESSAGE_TRANSMITTER_CONTRACT,
      process.env.NEXT_PUBLIC_STELLAR_MESSAGE_TRANSMITTER_CONTRACT_TESTNET,
    ) || base.messageTransmitterContract,
};

/**
 * Sponsor secret. A dedicated testnet sponsor is preferred so a preview deployment never
 * holds the mainnet key, but the shared key is accepted as a fallback: the same keypair
 * is a valid account on both networks, and a signature cannot replay across them because
 * the network passphrase is part of what gets signed.
 */
export function stellarSponsorSecret(): string | undefined {
  if (IS_TESTNET) {
    return (
      process.env.STELLAR_SPONSOR_SECRET_KEY_TESTNET ||
      process.env.STELLAR_SPONSOR_SECRET_KEY
    );
  }
  return process.env.STELLAR_SPONSOR_SECRET_KEY;
}

/** True when Circle's CCTP contracts are available on the selected network. */
export const STELLAR_CCTP_AVAILABLE = Boolean(
  STELLAR.tokenMessengerContract && STELLAR.cctpForwarder,
);
