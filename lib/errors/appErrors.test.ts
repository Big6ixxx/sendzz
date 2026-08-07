/**
 * Error classification, checked against real payloads.
 *
 * The classifier matches substrings against a message that, for a failed userOperation,
 * contains kilobytes of hex — calldata, factoryData, a WebAuthn signature. Short tokens
 * are matched inside that hex by accident, and every rule added later inherits the
 * problem, so the realistic fixtures below matter more than the tidy ones.
 *
 * The AA13 case is taken verbatim from a Polygon claim that failed while the smart
 * account was still counterfactual on that chain.
 */

import { describe, it, expect } from 'vitest';
import { classifyAppError } from './appErrors';

const CALLDATA =
  '0xb61d27f6000000000000000000000000e737e5cebeeba77efe34d4aa090756590b1ce275000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000002a457ecfd280000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000017800000001000000060000000750000000000000000000000000000000000000000';

const AA13_MESSAGE = [
  'Failed to simulate deployment for Smart Account.',
  '',
  'This could arise when:',
  '- Invalid `factory`/`factoryData` or `initCode` properties are present',
  '- Smart Account deployment execution ran out of gas (low `verificationGasLimit` value)',
  '- Smart Account deployment execution reverted with an error',
  '',
  'Request Arguments:',
  `  callData: ${CALLDATA}`,
  '  verificationGasLimit: 265000',
  '',
  'Details: validation reverted: [reason]: AA13 initCode failed or OOG',
  'Version: viem@2.47.10',
].join('\n');

describe('classifyAppError', () => {
  it('does not tell the user to check their connection when a userOp reverted', () => {
    // The failure is a gas limit, not connectivity. Sending someone to their wifi
    // settings for an on-chain revert costs them the one clue they had.
    const result = classifyAppError(new Error(AA13_MESSAGE));

    expect(result.category).not.toBe('network');
    expect(result.message.toLowerCase()).not.toContain('connection');
  });

  it('never leaks calldata or hex into a user-facing message', () => {
    const result = classifyAppError(new Error(AA13_MESSAGE));

    expect(result.message).not.toContain('0x');
    expect(result.message.length).toBeLessThanOrEqual(120);
  });

  it('treats a failed deployment as retryable rather than user-cancelled', () => {
    // isSilent suppresses the toast entirely — a real failure would vanish.
    const result = classifyAppError(new Error(AA13_MESSAGE));

    expect(result.isSilent).toBe(false);
    expect(result.isAlreadyProcessed).toBe(false);
  });

  it('still recognises a genuine network failure', () => {
    expect(classifyAppError(new Error('fetch failed')).category).toBe('network');
    expect(classifyAppError(new Error('Service returned HTTP 503')).category).toBe('network');
  });

  it('still recognises an already-delivered message', () => {
    const result = classifyAppError(new Error('nonce already used'));

    expect(result.isAlreadyProcessed).toBe(true);
  });

  it('does not mistake hex for an HTTP status', () => {
    // "502"/"503" occur constantly inside calldata. Matching them there classified an
    // on-chain revert as a connectivity problem.
    const hexOnly = `Execution failed. Request Arguments: callData: 0xdead502503beef${'0'.repeat(64)}`;

    expect(classifyAppError(new Error(hexOnly)).category).not.toBe('network');
  });
});
