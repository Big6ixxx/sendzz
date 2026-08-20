/**
 * Deciding the ONE fiat figure a withdrawal is recorded with.
 *
 * A withdrawal quotes a payout, pays a payout, and prints a receipt. Those were three separate
 * numbers: the quote came from an indicative rate endpoint, the payout settled at the provider's
 * own quote rate, and the receipt stored the browser's `amount × display rate`. A user quoted
 * 58,063 NGN was paid 57,958 and shown a third figure again.
 *
 * The rule that collapses them: whoever PAYS decides. This module is that rule, kept out of
 * `lib/actions/*` because every export there is a client-callable server action — and out of
 * the provider adapters because it is about arbitrating BETWEEN providers, not serving one.
 */
import { Ramp } from "./index";
import type {
  RampCurrency,
  RampNetwork,
  RampOrderResponse,
  RampPayoutQuote,
  RampProviderName,
} from "./types";

export interface PayoutFigureContext {
  amountUsdc: number;
  fiatCurrency: RampCurrency;
  network: RampNetwork;
  /** The provider the caller's estimate was quoted by, if any. */
  quotedBy?: RampProviderName;
  fiatAmount?: number;
  exchangeRate?: number;
}

export interface PayoutFigure {
  fiatAmount: number | undefined;
  exchangeRate: number | undefined;
}

/** Ask a provider for its own price. Injectable so the decision can be tested without a network. */
export type QuoteLookup = (
  provider: RampProviderName,
  params: { amountUsdc: number; fiatCurrency: RampCurrency; network: RampNetwork },
) => Promise<RampPayoutQuote | null>;

const liveQuote: QuoteLookup = (provider, params) => Ramp.quoteOffRampFor(provider, params);

/**
 * The fiat figure to record against a withdrawal, and the rate it was struck at.
 *
 * Order of authority, strongest first:
 *   1. the order's own figure (`order.fiatAmount`) — priced by the provider that will pay it;
 *   2. a quote taken from THAT provider now, if the order did not state one;
 *   3. the caller's estimate — but ONLY if it came from this same provider.
 *
 * The provider check in (3) is the whole point. Providers are tried in turn and the user is
 * quoted by whichever one leads the list; when that one is down, a different provider settles at
 * its own price. Carrying the first provider's number onto the second's payout would rebuild the
 * exact quote-vs-payout mismatch this path exists to eliminate, just by a rarer route. So a
 * foreign estimate is discarded and `undefined` returned rather than a wrong number — the
 * receipt then fills in from the settlement webhook, instead of printing a fiction.
 */
export async function resolvePayoutFiat(
  order: RampOrderResponse,
  settlingProvider: RampProviderName,
  ctx: PayoutFigureContext,
  quoteLookup: QuoteLookup = liveQuote,
): Promise<PayoutFigure> {
  const rateFor = (amount: number) =>
    ctx.amountUsdc > 0 ? amount / ctx.amountUsdc : undefined;

  const stated = Number(order.fiatAmount);
  if (order.fiatAmount != null && Number.isFinite(stated) && stated > 0) {
    return { fiatAmount: stated, exchangeRate: order.fiatRate ?? rateFor(stated) };
  }

  // The order stated nothing. Ask the provider that is actually going to pay.
  const own = await quoteLookup(settlingProvider, {
    amountUsdc: ctx.amountUsdc,
    fiatCurrency: ctx.fiatCurrency,
    network: ctx.network,
  }).catch(() => null);
  if (own && Number.isFinite(own.payoutAmount) && own.payoutAmount > 0) {
    return { fiatAmount: own.payoutAmount, exchangeRate: own.rate };
  }

  // Last resort: the caller's estimate, and only if this provider is the one that gave it.
  if (ctx.quotedBy && ctx.quotedBy !== settlingProvider) {
    console.warn(
      `[Ramp] ${settlingProvider} settled an order quoted by ${ctx.quotedBy} and stated no ` +
        `payout — recording no fiat amount rather than ${ctx.quotedBy}'s price. The settlement ` +
        `webhook will reconcile it.`,
    );
    return { fiatAmount: undefined, exchangeRate: undefined };
  }

  const estimate =
    ctx.fiatAmount ?? (ctx.exchangeRate ? ctx.amountUsdc * ctx.exchangeRate : undefined);
  return { fiatAmount: estimate, exchangeRate: ctx.exchangeRate };
}
