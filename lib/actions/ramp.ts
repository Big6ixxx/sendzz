'use server';

import { getBitnobClient } from '@/lib/bitnob/client';

/**
 * Initiates an on-ramp checkout via Bitnob
 */
export async function initiateOnRamp(
  amountNgn: number,
  userId: string,
  userAddress: string,
) {
  const bitnob = getBitnobClient();
  let checkout;

  try {
    checkout = await bitnob.createCheckout({
      amount: amountNgn,
      reference: `onramp_${Date.now()}_${userAddress}`,
      description: `Sendzz Deposit for ${userAddress}`,
      successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?status=success`,
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error initiating Bitnob on-ramp:', error.message || error);
    throw error;
  }

  // Bitnob response structure can vary between sandbox and production
  return checkout.data.checkoutUrl || checkout.data.hosted_url || checkout.data.url;
}

/**
 * Gets a quote for off-ramping USDC to NGN via Bitnob
 */
export async function getOffRampQuote(amountUsdc: number) {
  const bitnob = getBitnobClient();
  return await bitnob.createOfframpQuote({
    fromAsset: 'usdc',
    toCurrency: 'ngn',
    amount: amountUsdc,
  });
}

/**
 * Finalizes a Bitnob payout with bank details
 */
export async function finalizeOffRamp(
  quoteId: string,
  accountNumber: string,
  bankCode: string,
) {
  const bitnob = getBitnobClient();
  return await bitnob.finalizeQuote(quoteId, {
    bankDetails: {
      accountNumber,
      bankCode,
    },
  });
}
