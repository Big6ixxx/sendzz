/**
 * The two Stellar constants every module here needs.
 *
 * They used to be re-declared in each file that touched Horizon. Harmless until one of them
 * changes — a testnet issuer, a private Horizon — and gets updated everywhere but one, which
 * then fails only on whichever path was missed.
 *
 * Deliberately free of imports and side effects, so the cheapest server module can pull it in
 * without dragging the Stellar SDK or a Privy client along.
 */

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';

/** Circle's USDC classic asset issuer on Stellar mainnet. */
export const STELLAR_USDC_ISSUER =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
