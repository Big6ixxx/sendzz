/**
 * GET /api/stellar/signer-id
 *
 * Returns the Privy key quorum ID for the server's authorization key.
 * The frontend needs this to call addSigners() — which grants the server
 * permission to sign transactions on behalf of the user's Stellar wallet.
 *
 * The PRIVY_KEY_QUORUM_ID is the ID shown in the Privy Dashboard when you
 * created the authorization key (it looks like: key-quorum-xxxxxxxx-xxxx-...)
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const keyQuorumId = process.env.PRIVY_KEY_QUORUM_ID;

  if (!keyQuorumId) {
    return NextResponse.json(
      {
        error:
          'PRIVY_KEY_QUORUM_ID is not configured. ' +
          'Find it in Privy Dashboard → Wallet infrastructure → Authorization keys. ' +
          'It is the "Key quorum ID" shown when you created the authorization key.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ keyQuorumId });
}
