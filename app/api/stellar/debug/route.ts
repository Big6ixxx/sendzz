/**
 * GET /api/stellar/debug?address=G...
 *
 * Diagnostic endpoint — reveals exactly what's blocking the trustline.
 * Remove or protect this route before going to production.
 */

import { NextRequest, NextResponse } from 'next/server';

const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ?? 'https://horizon.stellar.org';
const USDC_CLASSIC_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address') ?? '';

  // 1. Check env
  const sponsorKeySet = !!process.env.STELLAR_SPONSOR_SECRET_KEY;
  const sponsorKeyLength = process.env.STELLAR_SPONSOR_SECRET_KEY?.length ?? 0;
  const horizonUrl = STELLAR_HORIZON_URL;
  const networkPassphrase = process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? 'NOT SET';

  // 2. Hit Horizon for the account
  let accountStatus = 'not_checked';
  let xlmBalance = '0';
  let hasTrustline = false;
  let horizonRaw: unknown = null;
  let horizonError: string | null = null;

  if (address) {
    try {
      const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
      horizonRaw = await res.json();
      if (res.status === 404) {
        accountStatus = 'not_found_on_chain';
      } else if (!res.ok) {
        accountStatus = `horizon_error_${res.status}`;
      } else {
        accountStatus = 'found';
        const data = horizonRaw as {
          balances?: { asset_code?: string; asset_issuer?: string; asset_type?: string; balance?: string }[];
        };
        const xlmEntry = data.balances?.find((b) => b.asset_type === 'native');
        xlmBalance = xlmEntry?.balance ?? '0';
        hasTrustline = !!data.balances?.some(
          (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_CLASSIC_ISSUER,
        );
      }
    } catch (e) {
      horizonError = (e as Error).message;
      accountStatus = 'fetch_failed';
    }
  }

  // 3. Sponsor key validity + on-chain check
  let sponsorKeyValid = false;
  let sponsorAddress = '';
  let sponsorOnChain = false;
  let sponsorXlmBalance = '0';
  if (sponsorKeySet) {
    try {
      const { Keypair } = await import('@stellar/stellar-sdk');
      const kp = Keypair.fromSecret(process.env.STELLAR_SPONSOR_SECRET_KEY!);
      sponsorAddress = kp.publicKey();
      sponsorKeyValid = true;

      // Check sponsor is actually on the network
      const sponsorRes = await fetch(`${STELLAR_HORIZON_URL}/accounts/${sponsorAddress}`);
      if (sponsorRes.ok) {
        sponsorOnChain = true;
        const sponsorData = (await sponsorRes.json()) as {
          balances?: { asset_type?: string; balance?: string }[];
        };
        const xlm = sponsorData.balances?.find((b) => b.asset_type === 'native');
        sponsorXlmBalance = xlm?.balance ?? '0';
      }
    } catch {
      sponsorKeyValid = false;
    }
  }

  // 4. Auth key format check
  const rawAuthKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY ?? '';
  const authKeySet = rawAuthKey.length > 0;
  const authKeyHasPemHeaders = rawAuthKey.includes('-----');
  const authKeyHasNewlines = rawAuthKey.includes('\n') || rawAuthKey.includes('\\n');
  const authKeyLength = rawAuthKey.length;
  // Valid PKCS8 base64 for P-256 starts with MIGHAgEA or MIHs (138 or 119 base64 chars typically)
  const authKeyLooksValid = authKeyLength > 100 && !authKeyHasPemHeaders;

  return NextResponse.json({
    env: {
      horizonUrl,
      networkPassphrase,
      sponsorKeySet,
      sponsorKeyLength,
      sponsorKeyValid,
      sponsorAddress: sponsorAddress ? `${sponsorAddress.slice(0, 6)}...${sponsorAddress.slice(-4)}` : null,
      sponsorOnChain,
      sponsorXlmBalance,
      authKey: {
        set: authKeySet,
        length: authKeyLength,
        hasPemHeaders: authKeyHasPemHeaders,
        hasNewlines: authKeyHasNewlines,
        looksValid: authKeyLooksValid,
        // Show first 20 chars so you can verify it's not a JWT or wrong key type
        preview: authKeySet ? rawAuthKey.slice(0, 20) + '...' : null,
        fix: authKeyHasPemHeaders
          ? 'Remove the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines and all newlines. Only paste the base64 content.'
          : authKeyHasNewlines
          ? 'Remove all newlines (\\n) from the key — it must be a single unbroken base64 string.'
          : authKeyLooksValid
          ? 'Format looks correct.'
          : 'Key may be too short or wrong format. Expected a base64 PKCS8 P-256 key (~180 chars).',
      },
    },
    account: address
      ? {
          address,
          accountStatus,
          xlmBalance,
          hasTrustline,
          horizonError,
        }
      : 'Pass ?address=G... to check account status',
  });
}
