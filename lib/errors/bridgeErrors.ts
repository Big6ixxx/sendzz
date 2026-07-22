/**
 * Bridge error classifier — converts raw blockchain / contract / network errors into
 * friendly user messages. Always logs the full error to console for debugging.
 *
 * Usage:
 *   const { userMessage, isAlreadyMinted } = classifyBridgeError(err);
 *   toast.error(userMessage);
 */

export interface ClassifiedError {
  /** Message safe to display to the end user */
  userMessage: string;
  /** True when the nonce was already used — USDC already arrived, safe to refresh */
  isAlreadyMinted: boolean;
  /** Technical category for analytics / further branching */
  category:
    | 'already_minted'
    | 'attestation_pending'
    | 'wallet_not_ready'
    | 'user_rejected'
    | 'gas_too_low'
    | 'network'
    | 'contract'
    | 'unknown';
}

function raw(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function classifyBridgeError(err: unknown): ClassifiedError {
  const msg = raw(err).toLowerCase();

  // Log full error for engineers / debugging
  console.error('[Bridge] Raw error:', err);

  // ── Already minted (nonce already used) ─────────────────────────────────
  if (
    msg.includes('nonce already used') ||
    msg.includes('message already received') ||
    msg.includes('message already processed')
  ) {
    return {
      userMessage:
        'Your USDC has already arrived on the destination chain. Please refresh your balance.',
      isAlreadyMinted: true,
      category: 'already_minted',
    };
  }

  // ── Attestation still finalising ─────────────────────────────────────────
  if (
    msg.includes('pending') ||
    msg.includes('attestation not found') ||
    msg.includes('still finalizing') ||
    msg.includes('not yet available') ||
    msg.includes('not ready')
  ) {
    return {
      userMessage: 'Circle is still processing the transfer. Please try again in 1–2 minutes.',
      isAlreadyMinted: false,
      category: 'attestation_pending',
    };
  }

  // ── Privy wallet not initialised yet ─────────────────────────────────────
  if (
    msg.includes('no accounts') ||
    msg.includes('wallet not ready') ||
    msg.includes('privy wallet not ready') ||
    msg.includes('embedded wallet not found')
  ) {
    return {
      userMessage: 'Your wallet is still loading. Please wait a moment and try again.',
      isAlreadyMinted: false,
      category: 'wallet_not_ready',
    };
  }

  // ── User explicitly rejected the transaction ──────────────────────────────
  if (
    msg.includes('user rejected') ||
    msg.includes('user denied') ||
    msg.includes('rejected the request') ||
    msg.includes('cancelled') ||
    msg.includes('canceled')
  ) {
    return {
      userMessage: 'Transaction was cancelled. You can try again whenever you are ready.',
      isAlreadyMinted: false,
      category: 'user_rejected',
    };
  }

  // ── Gas / fee issues ──────────────────────────────────────────────────────
  if (
    msg.includes('insufficient funds') ||
    msg.includes('gas required exceeds') ||
    msg.includes('fee too low') ||
    msg.includes('underpriced')
  ) {
    return {
      userMessage: 'Insufficient funds to cover network fees. Please add ETH and try again.',
      isAlreadyMinted: false,
      category: 'gas_too_low',
    };
  }

  // ── Network / RPC issues ──────────────────────────────────────────────────
  if (
    msg.includes('network error') ||
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('503') ||
    msg.includes('502')
  ) {
    return {
      userMessage: 'Network issue. Please check your connection and try again.',
      isAlreadyMinted: false,
      category: 'network',
    };
  }

  // ── Generic contract revert (calldata / hex blobs) ────────────────────────
  if (
    msg.includes('execution reverted') ||
    msg.includes('revert') ||
    msg.includes('0x') ||
    msg.includes('calldata') ||
    msg.includes('callerror')
  ) {
    return {
      userMessage:
        'The claim transaction could not be completed at this time. Please try again shortly.',
      isAlreadyMinted: false,
      category: 'contract',
    };
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return {
    userMessage: 'Something went wrong. Please try again or contact support if this persists.',
    isAlreadyMinted: false,
    category: 'unknown',
  };
}
