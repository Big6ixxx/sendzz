/**
 * Turning a routing decision into a description the user can read.
 *
 * Each builder takes the facts the flow has ALREADY worked out — which chains it will source
 * from, whether a bridge is needed, where it settles — and produces the step list from them.
 * That direction matters. A hand-written "this takes 2 steps" beside a route that sometimes
 * takes 3 is a lie that nobody notices until a user is staring at an unexpected third prompt.
 *
 * The wording avoids the vocabulary of the thing it describes. Nobody outside crypto knows
 * what a burn, an attestation or a user operation is, and a summary written in those terms
 * informs no one. "Move your money onto Base" and "Wait for the networks to agree" say what is
 * actually happening to someone who has never heard of either.
 */

import { CHAIN_NAMES, type SupportedChain } from '@/lib/circle/gateway';
import type { SigningPlan, SigningStep } from './plan';

/** Name a chain the way the rest of the product does, including the two non-EVM rails. */
export function chainLabel(chain: string): string {
  if (chain === 'solana') return 'Solana';
  if (chain === 'stellar') return 'Stellar';
  return CHAIN_NAMES[chain as SupportedChain] ?? chain;
}

/**
 * Gathering funds that are spread across networks, before anything can be sent.
 *
 * One confirmation per source, because that is literally what happens: each network holding a
 * piece of the balance has to be asked separately. This is the step that surprises people
 * most — they asked to send once and are asked to confirm three times — so it is always
 * spelled out with the networks named.
 */
function gatherSteps(sources: string[], target: string): SigningStep[] {
  return sources.map((source) => ({
    kind: 'gather' as const,
    title: `Move your money from ${chainLabel(source)} to ${chainLabel(target)}`,
    detail:
      'Your balance is spread across networks, so it has to be brought together before it ' +
      'can be sent. This part moves your own money between your own accounts.',
    signature: true,
    estimateSeconds: 90,
  }));
}

/** Sending to another Sendzz user by email. */
export function describeTransfer(params: {
  amount: string;
  recipient: string;
  /** Networks that have to be consolidated first. Empty when one chain already covers it. */
  gatherFrom?: string[];
  settlementChain?: string;
}): SigningPlan {
  const { amount, recipient, gatherFrom = [], settlementChain = 'base' } = params;

  return {
    summary: `Sending $${parseFloat(amount || '0').toFixed(2)} to ${recipient}`,
    steps: [
      ...gatherSteps(gatherFrom, settlementChain),
      {
        kind: 'send',
        title: `Send $${parseFloat(amount || '0').toFixed(2)} to ${recipient}`,
        detail: 'They can spend it as soon as it lands.',
        signature: true,
        estimateSeconds: 20,
      },
    ],
  };
}

/** Sending to a wallet address, possibly on a different network than the funds sit on. */
export function describeCryptoSend(params: {
  amount: string;
  recipient: string;
  destChain: string;
  sourceChain?: string;
  gatherFrom?: string[];
}): SigningPlan {
  const { amount, recipient, destChain, sourceChain, gatherFrom = [] } = params;
  const short = `${recipient.slice(0, 6)}…${recipient.slice(-4)}`;
  const crossChain = !!sourceChain && sourceChain !== destChain;

  const steps: SigningStep[] = [...gatherSteps(gatherFrom, sourceChain ?? destChain)];

  if (crossChain) {
    steps.push(
      {
        kind: 'burn',
        title: `Start the move from ${chainLabel(sourceChain!)}`,
        detail: `Your money leaves ${chainLabel(sourceChain!)} on its way to ${chainLabel(destChain)}.`,
        signature: true,
        estimateSeconds: 30,
      },
      {
        kind: 'wait',
        title: 'Wait for the networks to agree',
        detail:
          'Nothing to do here — the two networks confirm the move between themselves. You can ' +
          'leave this page; we will finish it for you.',
        signature: false,
        estimateSeconds: 60,
      },
      {
        kind: 'claim',
        title: `Deliver to ${short} on ${chainLabel(destChain)}`,
        signature: true,
        estimateSeconds: 30,
      },
    );
  } else {
    steps.push({
      kind: 'send',
      title: `Send ${parseFloat(amount || '0').toFixed(2)} USDC to ${short}`,
      detail: `On ${chainLabel(destChain)}. Sending to a wallet address cannot be undone.`,
      signature: true,
      estimateSeconds: 20,
    });
  }

  return {
    summary: `Sending ${parseFloat(amount || '0').toFixed(2)} USDC to ${short}`,
    steps,
  };
}

/**
 * Moving your own money between networks.
 *
 * Always two confirmations with a wait in between, and that shape is the single most confusing
 * thing in the product: the first confirmation makes the money leave, and it then appears
 * nowhere for a minute or more. Saying so in advance is most of the fix.
 */
export function describeBridge(params: {
  amount: string;
  sourceChain: string;
  destChain: string;
}): SigningPlan {
  const { amount, sourceChain, destChain } = params;

  return {
    summary: `Moving ${parseFloat(amount || '0').toFixed(2)} USDC from ${chainLabel(sourceChain)} to ${chainLabel(destChain)}`,
    steps: [
      {
        kind: 'burn',
        title: `Send it out of ${chainLabel(sourceChain)}`,
        detail: 'Your money leaves the first network here. This part cannot be undone.',
        signature: true,
        estimateSeconds: 30,
      },
      {
        kind: 'wait',
        title: 'Wait for the two networks to agree',
        detail:
          'Your money is in transit and is not lost — it just is not visible on either ' +
          'network yet. You can close this page; we will finish the delivery for you.',
        signature: false,
        estimateSeconds: 90,
      },
      {
        kind: 'claim',
        title: `Receive it on ${chainLabel(destChain)}`,
        detail: 'The second confirmation. This is what makes it spendable again.',
        signature: true,
        estimateSeconds: 30,
      },
    ],
  };
}

/** Cashing out to a bank account. */
export function describeWithdrawal(params: {
  amountLabel: string;
  bankLabel: string;
  settlementChain: string;
  gatherFrom?: string[];
}): SigningPlan {
  const { amountLabel, bankLabel, settlementChain, gatherFrom = [] } = params;

  return {
    summary: `Withdrawing ${amountLabel} to ${bankLabel}`,
    steps: [
      ...gatherSteps(gatherFrom, settlementChain),
      {
        kind: 'settle',
        title: 'Send your money to our payout partner',
        detail: `From ${chainLabel(settlementChain)}. This is the last step you confirm.`,
        signature: true,
        estimateSeconds: 30,
      },
      {
        kind: 'wait',
        title: `Our partner pays ${bankLabel}`,
        detail:
          'Nothing more to confirm. Most banks show the money within minutes, though some ' +
          'take longer. We will email you when it is done.',
        signature: false,
        estimateSeconds: 120,
      },
    ],
  };
}

/** Paying several people at once. */
export function describeBatch(params: {
  recipientCount: number;
  total: number;
  gatherFrom?: string[];
  settlementChain?: string;
}): SigningPlan {
  const { recipientCount, total, gatherFrom = [], settlementChain = 'base' } = params;

  return {
    summary: `Paying ${recipientCount} ${recipientCount === 1 ? 'person' : 'people'} $${total.toFixed(2)} in total`,
    steps: [
      ...gatherSteps(gatherFrom, settlementChain),
      {
        kind: 'send',
        title: `Pay all ${recipientCount} recipients`,
        detail:
          'Each person is paid separately, so some can succeed while others fail. You will ' +
          'see exactly which is which, and can retry only the ones that did not go through.',
        signature: true,
        estimateSeconds: Math.min(240, 15 * recipientCount),
      },
    ],
  };
}
