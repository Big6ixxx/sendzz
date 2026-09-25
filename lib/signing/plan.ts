/**
 * What a transaction is about to ask of the user, written down before it starts.
 *
 * The complaint this answers: a bridge asks for two separate confirmations, minutes apart,
 * with a network switch in between — and until now the first the user heard of the second one
 * was when it appeared. To someone who has never used a wallet, a second prompt after they
 * thought they were finished does not read as "step two". It reads as "that did not work", or
 * worse, as something trying to take their money twice.
 *
 * So every flow now describes itself up front: how many times it will ask, what each one is
 * for, and roughly how long the whole thing takes. The description is DERIVED from the same
 * routing decisions that produce the transaction — see describe.ts — rather than written out
 * by hand at each screen, because a hand-maintained count is one that silently goes wrong the
 * first time the routing changes.
 */

/**
 * The kinds of step a flow is built from.
 *
 * Named for what the user experiences, not for the mechanism. "Approve" is not `approve()`
 * on an ERC-20; it is the moment they are asked to say yes.
 */
export type SigningStepKind =
  | 'gather'
  | 'send'
  | 'burn'
  | 'wait'
  | 'claim'
  | 'settle';

export interface SigningStep {
  kind: SigningStepKind;
  /** One short line, in the user's words. "Move your funds onto Base". */
  title: string;
  /** Optional second line, for when the title alone would leave someone guessing. */
  detail?: string;
  /**
   * Whether this step asks the user to confirm.
   *
   * This is the field the whole module exists for. Steps that merely take time — waiting for
   * a network to confirm a burn — must not be counted as confirmations, or the promise of
   * "2 confirmations" becomes another thing that turns out not to be true.
   */
  signature: boolean;
  /** Roughly how long this step takes, for the estimate. Omitted when it is effectively instant. */
  estimateSeconds?: number;
}

export interface SigningPlan {
  /** What the user is doing, e.g. "Sending $40.00 to ada@example.com". */
  summary: string;
  steps: SigningStep[];
}

/** How many times this flow will ask the user to confirm. */
export function signatureCount(plan: SigningPlan): number {
  return plan.steps.filter((step) => step.signature).length;
}

/**
 * "You'll be asked to confirm twice" — or nothing at all, when there is only one.
 *
 * A single confirmation needs no warning: it is what anybody expects from pressing Send. The
 * sentence exists for the cases that would otherwise surprise someone, so it stays quiet when
 * there is no surprise.
 */
export function confirmationNotice(plan: SigningPlan): string | null {
  const count = signatureCount(plan);
  if (count <= 1) return null;

  const word = count === 2 ? 'twice' : `${count} times`;
  return `You'll be asked to confirm ${word} — each one is a separate step, and we'll tell you where you are.`;
}

/**
 * A human estimate of the whole flow.
 *
 * Deliberately vague at the top end. A precise "about 4 minutes" on something that depends on
 * a CCTP attestation is a promise that gets broken regularly, and a broken estimate is worse
 * than a soft one: it turns an ordinary slow bridge into a reason to think something is wrong.
 */
export function durationEstimate(plan: SigningPlan): string {
  const seconds = plan.steps.reduce((total, step) => total + (step.estimateSeconds ?? 0), 0);

  if (seconds <= 30) return 'about half a minute';
  if (seconds <= 75) return 'about a minute';
  if (seconds <= 180) return 'a couple of minutes';
  if (seconds <= 420) return 'up to about five minutes';
  return 'ten minutes or so';
}
