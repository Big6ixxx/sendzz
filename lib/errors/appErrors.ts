/**
 * Centralized app error classifier for Sendzz.
 *
 * Converts ALL raw errors — blockchain reverts, UserOperation failures, Circle/Privy
 * errors, network issues — into safe, human-readable messages.
 *
 * Rules:
 *  - Always logs the FULL raw error to console.error for debugging.
 *  - NEVER surfaces raw calldata, hex strings, or stack traces to users.
 *  - Returns a short, actionable message the user can understand.
 *
 * Usage (anywhere in the app):
 *   import { parseAppError, isUserCancelled } from '@/lib/errors/appErrors';
 *
 *   } catch (err) {
 *     if (!isUserCancelled(err)) toast.error(parseAppError(err));
 *   }
 */

export interface AppError {
  message: string;
  category:
    | 'user_cancelled'
    | 'already_processed'
    | 'attestation_pending'
    | 'wallet_not_ready'
    | 'wallet_not_registered'
    | 'insufficient_funds'
    | 'network'
    | 'rate_limit'
    | 'service_unavailable'
    | 'contract_revert'
    | 'validation'
    | 'unknown';
  isSilent: boolean;
  isAlreadyProcessed: boolean;
}

function raw(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function classifyAppError(err: unknown): AppError {
  const msg = raw(err).toLowerCase();
  console.error('[App Error]', err);

  if (
    msg.includes('user rejected') ||
    msg.includes('user denied') ||
    msg.includes('rejected the request') ||
    msg.includes('cancelled') ||
    msg.includes('canceled') ||
    msg.includes('user cancelled')
  ) {
    return { message: 'Transaction cancelled.', category: 'user_cancelled', isSilent: true, isAlreadyProcessed: false };
  }

  if (
    msg.includes('nonce already used') ||
    msg.includes('message already received') ||
    msg.includes('message already processed')
  ) {
    return { message: 'This transfer was already processed. Please refresh your balance.', category: 'already_processed', isSilent: false, isAlreadyProcessed: true };
  }

  if (
    msg.includes('pending_confirmations') ||
    msg.includes('attestation not found') ||
    msg.includes('still finalizing') ||
    msg.includes('attestation is still pending')
  ) {
    return { message: 'Transfer is still being verified. Please try again in 1–2 minutes.', category: 'attestation_pending', isSilent: false, isAlreadyProcessed: false };
  }

  if (
    msg.includes('no accounts') ||
    msg.includes('wallet not ready') ||
    msg.includes('privy wallet not ready') ||
    msg.includes('embedded wallet not found')
  ) {
    return { message: 'Your wallet is still loading. Please wait a moment and try again.', category: 'wallet_not_ready', isSilent: false, isAlreadyProcessed: false };
  }

  if (
    msg.includes('cannot find target wallet') ||
    msg.includes("wallet doesn't exist") ||
    msg.includes('wallet not registered')
  ) {
    return { message: 'Your wallet is being set up for the first time. Please try again in a few seconds.', category: 'wallet_not_registered', isSilent: false, isAlreadyProcessed: false };
  }

  if (
    msg.includes('useroperation') ||
    msg.includes('user operation') ||
    msg.includes('executing user operation') ||
    msg.includes('entrypoint')
  ) {
    if (msg.includes('simulatevalidation') || msg.includes('simulate validation'))
      return { message: 'Gas station sponsorship is currently unavailable on this chain. Please ensure the gas policy has sufficient deposit or try another chain.', category: 'service_unavailable', isSilent: false, isAlreadyProcessed: false };
    if (msg.includes('aa21') || msg.includes("didn't pay prefund") || msg.includes('prefund'))
      return { message: 'Insufficient funds to cover the network fee.', category: 'insufficient_funds', isSilent: false, isAlreadyProcessed: false };
    if (msg.includes('aa25') || msg.includes('invalid account nonce'))
      return { message: 'Transaction conflict detected. Please wait a moment and try again.', category: 'unknown', isSilent: false, isAlreadyProcessed: false };
    if (msg.includes('json is not a valid request object'))
      return { message: 'Transfer service is temporarily unavailable. Please try again shortly.', category: 'service_unavailable', isSilent: false, isAlreadyProcessed: false };
    return { message: 'Transaction could not be completed. Please try again.', category: 'contract_revert', isSilent: false, isAlreadyProcessed: false };
  }

  if (
    msg.includes('insufficient funds') ||
    msg.includes('insufficient balance') ||
    msg.includes('gas required exceeds') ||
    msg.includes('fee too low') ||
    msg.includes('underpriced')
  ) {
    return { message: 'Insufficient balance to complete this action.', category: 'insufficient_funds', isSilent: false, isAlreadyProcessed: false };
  }

  if (
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('503') ||
    msg.includes('502')
  ) {
    return { message: 'Network issue. Please check your connection and try again.', category: 'network', isSilent: false, isAlreadyProcessed: false };
  }

  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('429')) {
    return { message: 'Too many requests. Please wait a moment and try again.', category: 'rate_limit', isSilent: false, isAlreadyProcessed: false };
  }

  if (
    msg.includes('execution reverted') ||
    msg.includes('revert') ||
    msg.includes('calldata') ||
    msg.includes('request arguments') ||
    (msg.includes('0x') && msg.length > 200)
  ) {
    return { message: 'Action could not be completed right now. Please try again.', category: 'contract_revert', isSilent: false, isAlreadyProcessed: false };
  }

  const rawMsg = raw(err);
  if (rawMsg.length <= 120 && !rawMsg.includes('0x') && !rawMsg.startsWith('Error:')) {
    return { message: rawMsg, category: 'unknown', isSilent: false, isAlreadyProcessed: false };
  }

  return { message: 'Something went wrong. Please try again or contact support if this persists.', category: 'unknown', isSilent: false, isAlreadyProcessed: false };
}

/** Shorthand: returns just the user-safe message string */
export function parseAppError(err: unknown): string {
  return classifyAppError(err).message;
}

/** Returns true when the error is a silent user cancellation — no toast needed */
export function isUserCancelled(err: unknown): boolean {
  return classifyAppError(err).isSilent;
}
