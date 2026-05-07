'use server';

import { getBitnobClient } from '@/lib/bitnob/client';
import { getPaycrestClient } from '@/lib/paycrest/client';

/**
 * PAYCREST ON-RAMP (DEFAULT)
 * Initiates an on-ramp order via Paycrest
 */
export async function initiateOnRamp({
  amountNgn,
  userId,
  userAddress,
  userEmail,
  refundAccount,
}: {
  amountNgn: number;
  userId: string;
  userAddress: string;
  userEmail: string;
  refundAccount: { institution: string; accountIdentifier: string; accountName: string };
}) {
  const paycrest = getPaycrestClient();
  
  try {
    const safeUserId = userId.replace(/[^a-z0-9]/gi, '');
    const order = await paycrest.createOrder({
      amount: amountNgn.toString(),
      amountIn: 'fiat',
      source: {
        type: 'fiat',
        currency: 'NGN',
        refundAccount,
      },
      destination: {
        type: 'crypto',
        currency: 'USDC',
        recipient: {
          address: userAddress,
          network: 'base',
        }
      },
      reference: `onramp${Date.now()}${safeUserId}`,
    });

    // Record in internal ledger
    const { recordDeposit } = await import('@/lib/supabase/actions');
    await recordDeposit({
      userEmail,
      amountFiat: amountNgn,
      currencyFiat: 'NGN',
      amountUsdc: 0, // Will be updated when confirmed
      status: 'pending',
      paycrestTxId: order.id,
    });

    return order;
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Error initiating Paycrest on-ramp:', err.message || error);
    throw error;
  }
}

/**
 * Get the live NGN→USDC buy rate from Paycrest
 */
export async function getOnRampRate(): Promise<number> {
  const paycrest = getPaycrestClient();
  const rates = await paycrest.getRates('base', 'USDC', 1, 'NGN');
  const buyRate = rates.data.buy?.rate;
  if (!buyRate) throw new Error('Could not fetch onramp rate');
  return Number(buyRate);
}

/**
 * Fetch the current status of an order
 */
export async function getOrderStatus(orderId: string) {
  const paycrest = getPaycrestClient();
  return paycrest.getOrder(orderId);
}

/**
 * Save order reference to allow resuming from a dedicated route
 * Returns the order details for status checking
 */
export async function checkOrderById(orderId: string) {
  const paycrest = getPaycrestClient();
  try {
    return await paycrest.getOrder(orderId);
  } catch {
    return null;
  }
}

/**
 * PAYCREST OFF-RAMP QUOTE (DEFAULT)
 */
export async function getOffRampQuote(amountUsdc: number) {
  const paycrest = getPaycrestClient();
  
  try {
    const rates = await paycrest.getRates('base', 'USDC', amountUsdc, 'NGN');
    return {
      rate: rates.data.sell?.rate || 0,
      payoutAmount: amountUsdc * (rates.data.sell?.rate || 0),
      provider: 'paycrest'
    };
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Error fetching Paycrest rates:', err.message || error);
    throw error;
  }
}

/**
 * PAYCREST OFF-RAMP EXECUTION (DEFAULT)
 */
export async function finalizeOffRamp(
  amountUsdc: number,
  accountNumber: string,
  bankCode: string,
  accountName: string,
  userRefundAddress: string,
  userEmail: string
) {
  const paycrest = getPaycrestClient();
  
  try {
    const order = await paycrest.createOrder({
      amount: amountUsdc.toString(),
      amountIn: 'crypto',
      source: {
        type: 'crypto',
        currency: 'USDC',
        network: 'base',
        refundAddress: userRefundAddress
      },
      destination: {
        type: 'fiat',
        currency: 'NGN',
        recipient: {
          institution: bankCode,
          accountIdentifier: accountNumber,
          accountName: accountName,
        }
      },
      reference: `offramp_${Date.now()}`,
    });

    // Record in internal ledger
    const { recordWithdrawal } = await import('@/lib/supabase/actions');
    await recordWithdrawal({
      userEmail,
      amountUsdc,
      fiatCurrency: 'NGN',
      bankAccountMasked: accountNumber.replace(/.(?=.{4})/g, '*'),
      institutionCode: bankCode,
      status: 'processing',
      paycrestOrderId: order.id,
    });

    return order;
  } catch (error: unknown) {
    const err = error as Error;
    console.error('Error finalizing Paycrest off-ramp:', err.message || error);
    throw error;
  }
}

/**
 * Verify Bank Account
 */
export async function verifyBankAccount(institution: string, accountNumber: string) {
  console.log(`[Action] verifyBankAccount: ${institution} / ${accountNumber}`);
  const paycrest = getPaycrestClient();
  try {
    const result = await paycrest.verifyAccount(institution, accountNumber);
    console.log(`[Action] verifyBankAccount result:`, result);
    return result;
  } catch (error) {
    console.error(`[Action] verifyBankAccount failed:`, error);
    throw error;
  }
}

/**
 * BITNOB FUNCTIONS
 */
export async function initiateBitnobOnRamp(
  amountNgn: number,
  userId: string,
  userAddress: string,
) {
  const bitnob = getBitnobClient();
  const checkout = await bitnob.createCheckout({
    amount: amountNgn,
    reference: `onramp_bitnob_${Date.now()}_${userAddress}`,
    description: `Sendzz Deposit for ${userAddress}`,
    successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?status=success`,
  });
  return checkout.data.checkoutUrl || checkout.data.hosted_url || checkout.data.url;
}

export async function getBitnobOffRampQuote(amountUsdc: number) {
  const bitnob = getBitnobClient();
  return await bitnob.createOfframpQuote({
    fromAsset: 'usdc',
    toCurrency: 'ngn',
    amount: amountUsdc,
  });
}

export async function finalizeBitnobOffRamp(
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

/**
 * UTILITIES
 */
export async function getInstitutions(currency: string = 'NGN') {
  const paycrest = getPaycrestClient();
  return await paycrest.getInstitutions(currency);
}
