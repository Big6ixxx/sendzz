import {
  parseUnits,
  encodeFunctionData,
  createPublicClient,
  http,
  type PublicClient
} from 'viem';
import { type BundlerClient } from 'viem/account-abstraction';
import { type ConnectedWallet } from '@privy-io/react-auth';
import { VIEM_CHAINS } from './multichain';
import {
  TOKEN_MESSENGER_V2,
  MESSAGE_TRANSMITTER_V2,
  USDC_ADDRESSES,
  CCTP_DOMAINS,
  GAS_POLICY_IDS,
  CHAIN_NAMES,
  CHAIN_IDS,
  type SupportedChain,
  type AttestationResponse,
  calculateMaxFee
} from '../circle/gateway';
import { solanaMintRecipientBytes32 } from '../circle/solana-gateway';

import { getCircleClient, getStandardRpcUrl } from './circle-client';
import { rpcTransport } from './rpc';
import { IS_TESTNET } from './network';
import { findMintTxHash, isMessageDelivered } from './cctp-delivery';
import { EVM_CHAINS, type ChainBalances, type SolanaSource, type SourceChainKey } from './routing';
import { toast } from 'sonner';
import { HOME_CHAIN } from '@/lib/explorers';

/**
 * Gas price for a sponsored userOperation.
 *
 * Ask the bundler, don't guess. This used to price userOps from a public RPC's
 * `estimateFeesPerGas`, which targets ordinary EOA transactions: it pads the base fee
 * by 1.2x and passes the node's priority suggestion through untouched. On Base that
 * produced maxFee 0.007 gwei / priority 0.001 gwei — the *median* priority fee, with
 * 0.002 gwei of headroom. An EOA transaction priced there lands eventually; a
 * userOperation doesn't, because a bundler has to batch it and only earns the margin.
 * Ops were accepted into the mempool and then never mined, one 300s timeout at a time,
 * and since each retry drew a fresh nonce key they piled up instead of replacing one
 * another — no bridge ever got past `approve`.
 *
 * `getUserOperationGasPrice` is the bundler quoting its own price, which is what the
 * send path in circle-actions already uses (and why sends worked while bridges did
 * not). We take `high` rather than `medium`: a stalled bridge can strand a transfer
 * whose burn already happened, so the few cents of headroom are worth it — and the
 * paymaster pays, not the user.
 *
 * The padded RPC estimate stays as a fallback for when the bundler won't quote.
 */
/**
 * Multiplier on the bundler's quoted ceiling.
 *
 * `maxFeePerGas` is a cap, not a payment — the op is charged the actual base fee plus
 * the priority fee, and the rest is refunded. Raising the cap therefore costs nothing
 * unless gas genuinely rises, while a cap set too close to spot turns an ordinary base
 * fee tick between quote and inclusion into a stalled transfer. Polygon's base fee
 * moved from ~458 to ~242 gwei inside a few minutes while this was being measured, so
 * the headroom is not theoretical. The priority fee is *not* padded — that one is
 * really paid, and the bundler's own `high` tier is the right number for it.
 */
const MAX_FEE_HEADROOM = 2n;

/**
 * `verificationGasLimit` has to land inside a window, and Circle guards both ends.
 *
 * Too low and the EntryPoint reverts with `AA26 over verificationGasLimit`. Too high and
 * the bundler rejects the op outright: it requires `used / limit >= 0.4`, so the limit
 * can be at most 2.5x what validation actually consumes. There is no "just set it
 * generously" option — over-provisioning fails as hard as under-provisioning.
 *
 * The SDK's own default is a flat 100,000 for a deployed account (from the `deployed`
 * field on `circle_getUserOperationGasPrice`), which it uses unless the caller passes a
 * value. That assumes an ECDSA owner. These accounts are passkey-owned, so
 * `validateUserOp` verifies a P256/WebAuthn signature — cheap where a chain exposes a
 * P256 precompile, ~130k+ where it runs in Solidity. Base, Arbitrum and Optimism fit
 * under 100k. Polygon measured ~132,900, so every claim there died on AA26 — after the
 * burn, with the USDC already committed.
 *
 * Since the true cost is per-chain and unknowable up front, this adapts instead of
 * guessing: start where the SDK would, then use whichever bound the bundler complains
 * about to compute the next attempt. The efficiency error is the useful one — it reports
 * the actual ratio, which yields the exact gas used and therefore the right limit.
 */
const SDK_DEFAULT_VERIFICATION_GAS = 100_000n;

/**
 * Known starting points, to skip a doomed first attempt. Measured 2026-08-04; if a chain
 * starts costing a round trip, re-measure rather than nudging the number.
 *
 * These are *validation-only* costs, measured against an account that already exists on
 * the chain. They must never be applied to an op that also has to deploy the account —
 * see `deployed` in `sendWithAdaptiveVerificationGas`.
 */
const VERIFICATION_GAS_SEED: Record<string, bigint> = {
  polygon: 265_000n, // validation measured at ~132,900 → 2x keeps efficiency at 0.5
};

/**
 * Where to retry after the bundler reports the deployment itself ran out of gas.
 *
 * Deploying a Circle modular account costs several times what validating one does, so
 * escalating from the validation-sized number gets nowhere. This overshoots deliberately:
 * the "efficiency too low" reply that a too-high limit provokes reports the exact ratio,
 * which converges on the right value in one more round trip. Being too low does not
 * converge on anything — it just fails again.
 */
const DEPLOYMENT_VERIFICATION_GAS = 1_000_000n;

/**
 * Does this smart account already exist on the chain its client is pointed at?
 *
 * Assumes *not* deployed when the check itself fails. That direction is the safe one: it
 * only means we skip the seed and let the bundler estimate, which costs nothing. Assuming
 * "deployed" on a failed check would re-create the bug this answers.
 */
async function isAccountDeployed(account: { isDeployed?: () => Promise<boolean> }): Promise<boolean> {
  if (typeof account.isDeployed !== 'function') return false;
  return account.isDeployed().catch(() => false);
}

/**
 * Send a sponsored userOperation, correcting `verificationGasLimit` against whichever
 * bound the bundler rejects. Bounded at four attempts; anything not about verification
 * gas is rethrown untouched so real failures aren't retried into confusion.
 *
 * `deployed` says whether the smart account already exists on this chain. It matters
 * because an op for an account that doesn't yet exist carries `factory`/`factoryData`,
 * and then `verificationGasLimit` has to pay for the *deployment* as well as the
 * signature check. Seeding such an op with a validation-sized number is how a claim on
 * the first-ever chain for a wallet died on `AA13 initCode failed or OOG` — which, until
 * this function learned to recognise it, was not retried at all: every attempt re-sent
 * the same too-small limit, and the failure came out of gas *estimation*, so the user was
 * never even prompted to sign.
 */
export async function sendWithAdaptiveVerificationGas(
  chain: string,
  send: (verificationGasLimit: bigint | undefined) => Promise<`0x${string}`>,
  deployed = true,
): Promise<`0x${string}`> {
  // An undeployed account gets no seed: the bundler's own estimate is the only one that
  // knows what this factory costs on this chain, and it accounts for the initCode.
  let limit: bigint | undefined = deployed
    ? VERIFICATION_GAS_SEED[chain.toLowerCase()]
    : undefined;

  for (let attempt = 0; ; attempt++) {
    try {
      return await send(limit);
    } catch (err) {
      if (attempt >= 3) throw err;

      const msg = err instanceof Error ? err.message : String(err);
      const applied: bigint = limit ?? SDK_DEFAULT_VERIFICATION_GAS;

      // "efficiency too low ... Actual: 0.1329" — actual/limit, so this pins gas used.
      const efficiency = msg.match(/efficiency too low[\s\S]*?Actual:\s*([0-9.]+)/i);
      if (efficiency) {
        const ratio = Number(efficiency[1]);
        if (Number.isFinite(ratio) && ratio > 0) {
          const used: bigint = BigInt(Math.ceil(Number(applied) * ratio));
          limit = used * 2n; // efficiency 0.5 — clear of the 0.4 floor from both sides
          console.warn(
            `[SmartBridge] ${chain} verification gas limit too high; validation used ~${used}. Retrying at ${limit}.`,
          );
          continue;
        }
      }

      // AA13 is the deployment leg running out of gas, AA26 the validation leg. Both mean
      // "too low", so both escalate — but AA13 starts from the deployment-sized number,
      // because tripling a validation-sized one lands short again.
      if (/AA13|initCode failed/i.test(msg)) {
        limit = bigMax(applied * 3n, DEPLOYMENT_VERIFICATION_GAS);
        console.warn(
          `[SmartBridge] ${chain} account deployment ran out of verification gas at ${applied}. Retrying at ${limit}.`,
        );
        continue;
      }

      if (/AA26|over verificationGasLimit/i.test(msg)) {
        limit = applied * 3n;
        console.warn(
          `[SmartBridge] ${chain} verification gas limit too low at ${applied}. Retrying at ${limit}.`,
        );
        continue;
      }

      throw err;
    }
  }
}

const BASE_FEE_PAD = 4n;
// Nodes return roughly the median (p50) priority fee. On Base that was 0.001 gwei while
// p90 sat at 0.007, so a 10x pad clears the 90th percentile rather than landing between
// percentiles and hoping.
const PRIORITY_FEE_PAD = 10n;

/**
 * Absolute priority-fee floors, set against what Circle's bundler actually quotes on
 * each chain (its `high` tier) with roughly 2x headroom.
 *
 * These exist because a chain's required priority fee is not proportional to its base
 * fee or to what its public node reports. Avalanche is the case that proves it: base fee
 * 0.19 gwei but the bundler wants 3.0 gwei of priority, so a formula scaled off either
 * number lands ~4x under the bundler's floor. Arbitrum's public node reports a priority
 * fee of exactly 0, which any multiplier leaves at 0.
 *
 * Polygon is the case that forces a *hard* floor rather than a formula. Bor refuses to
 * admit a transaction below its `txpool.pricelimit` — 30 gwei on PoS mainnet, 25 gwei on
 * Amoy — and it refuses it *silently*: the bundle is dropped from the mempool, so the
 * userOperation is accepted, never mined, and never errors. That is exactly what a
 * Polygon bridge looked like from the UI, while every other chain worked.
 *
 * Measured 2026-08-04 — re-check if a chain starts stalling at the approve step.
 */
const DEFAULT_MIN_PRIORITY_FEE = 10_000_000n; // 0.01 gwei — covers base/arbitrum/optimism
const MIN_PRIORITY_FEE: Record<string, bigint> = IS_TESTNET
  ? {
      // Amoy's Bor pricelimit is 25 gwei; 30 clears it with headroom. The mainnet
      // number below is far above what Amoy needs and only wastes paymaster funds.
      polygon: 30_000_000_000n,
      avalanche: 5_000_000_000n, // bundler high ≈ 3 gwei
    }
  : {
      polygon: 250_000_000_000n, // bundler high ≈ 156 gwei, above Bor's 30 gwei limit
      avalanche: 5_000_000_000n,
    };

const bigMax = (a: bigint, b: bigint) => (a > b ? a : b);

export async function sponsoredUserOpFees(
  bundlerClient: BundlerClient,
  client: PublicClient,
  chain: string,
): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const floor = MIN_PRIORITY_FEE[chain.toLowerCase()] ?? DEFAULT_MIN_PRIORITY_FEE;

  const { modularWalletActions } = await import('@circle-fin/modular-wallets-core');
  const quoted = await bundlerClient
    .extend(modularWalletActions)
    .getUserOperationGasPrice()
    .catch(() => null);

  const level = quoted?.high ?? quoted?.medium ?? null;
  if (level?.maxFeePerGas && level?.maxPriorityFeePerGas) {
    // The floor applies here too, not just to the fallback below. A bundler quote is
    // the bundler's opinion of a competitive fee, not a guarantee the chain's own
    // mempool will admit it — and on Polygon those two disagree. Leaving the floor on
    // the fallback path only meant it never ran, because the bundler always quotes.
    const maxPriorityFeePerGas = bigMax(BigInt(level.maxPriorityFeePerGas), floor);
    // maxFeePerGas is a ceiling that must cover the priority fee it sits above,
    // otherwise the op is rejected as malformed rather than merely underpriced.
    const maxFeePerGas = bigMax(
      BigInt(level.maxFeePerGas) * MAX_FEE_HEADROOM,
      maxPriorityFeePerGas * MAX_FEE_HEADROOM,
    );

    console.log(
      `[SmartBridge] ${chain} userOp fees (bundler-quoted${
        maxPriorityFeePerGas > BigInt(level.maxPriorityFeePerGas) ? ', raised to chain floor' : ''
      }): maxFee ${Number(maxFeePerGas) / 1e9} gwei, priority ${Number(maxPriorityFeePerGas) / 1e9} gwei`,
    );
    return { maxFeePerGas, maxPriorityFeePerGas };
  }

  const [feeData, block] = await Promise.all([
    client.estimateFeesPerGas().catch(() => null),
    client.getBlock({ blockTag: 'latest' }).catch(() => null),
  ]);

  const estimatedPriority = feeData?.maxPriorityFeePerGas ?? 1_000_000n;
  const maxPriorityFeePerGas = bigMax(estimatedPriority * PRIORITY_FEE_PAD, floor);

  const baseFee = block?.baseFeePerGas ?? 0n;
  const maxFeePerGas = bigMax(
    baseFee * BASE_FEE_PAD + maxPriorityFeePerGas,
    // If the block had no base fee (non-1559 node), pad the estimate instead.
    (feeData?.maxFeePerGas ?? 0n) * BASE_FEE_PAD,
  );

  console.log(
    `[SmartBridge] ${chain} userOp fees (padded estimate — bundler did not quote): ` +
      `maxFee ${Number(maxFeePerGas) / 1e9} gwei, priority ${Number(maxPriorityFeePerGas) / 1e9} gwei`,
  );

  return { maxFeePerGas, maxPriorityFeePerGas };
}

export async function resolveUserOpToTxHash(
  bundlerClient: BundlerClient,
  userOpHash: `0x${string}`,
  timeoutMs = 300_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await bundlerClient.getUserOperationReceipt({ hash: userOpHash });
      if (receipt) {
        if (receipt.success === false) {
          throw new Error('UserOperation reverted on-chain');
        }
        if (receipt.receipt?.transactionHash) {
          return receipt.receipt.transactionHash;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'UserOperation reverted on-chain') {
        throw err;
      }
      // receipt not yet available
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`UserOperation ${userOpHash} not confirmed within ${timeoutMs / 1000}s`);
}

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

const BALANCE_OF_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const TOKEN_MESSENGER_ABI = [
  {
    name: 'depositForBurn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
  {
    name: 'depositForBurnWithHook',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: 'nonce', type: 'uint64' }],
  },
] as const;

export async function executeSmartBridge(
  embeddedWallet: ConnectedWallet,
  sourceChain: SupportedChain,
  amountUSDC: string,
  recipientAddress: string,
  destChain: SupportedChain | 'stellar' | 'solana' = HOME_CHAIN
): Promise<{ userOpHash: `0x${string}`; txHashPromise: Promise<string> }> {

  try {
    if (sourceChain === destChain) {
      throw new Error('Source and destination chains must differ');
    }
    const chain = VIEM_CHAINS[sourceChain];
    const usdcAddress = USDC_ADDRESSES[sourceChain];
    const destinationDomain = destChain === 'stellar'
      ? 27
      : destChain === 'solana'
        ? 5
        : CCTP_DOMAINS[destChain as SupportedChain];


    if (!chain || !usdcAddress) throw new Error('Unsupported chain config');

    toast.info(`Preparing gasless transfer on ${sourceChain}...`);
    const ethereumProvider = await embeddedWallet.getEthereumProvider();
    const { bundlerClient, account } = await getCircleClient(ethereumProvider, sourceChain);

    const amountRaw = parseUnits(amountUSDC, 6);
    
    let mintRecipient: `0x${string}`;
    let destinationCaller = `0x${'0'.repeat(64)}` as `0x${string}`;
    let hookData: `0x${string}` | undefined;

    if (destChain === 'stellar') {
      const { StrKey } = await import('@stellar/stellar-sdk');
      const { STELLAR } = await import('@/lib/stellar/network');
      // Set mintRecipient and destinationCaller to network-appropriate CctpForwarder contract address
      const forwarderRawBytes = StrKey.decodeContract(STELLAR.cctpForwarder);
      mintRecipient = `0x${forwarderRawBytes.toString('hex')}`;
      destinationCaller = `0x${forwarderRawBytes.toString('hex')}`;

      // Build CCTP V2 hookData for Stellar:
      // magic (24 bytes) + version (4 bytes) + length (4 bytes uint32 BE) + recipient strkey string
      const magic = Buffer.alloc(24, 0);
      const version = Buffer.alloc(4, 0);
      const addrBytes = Buffer.from(recipientAddress, 'utf-8');
      const lenBuf = Buffer.alloc(4, 0);
      lenBuf.writeUInt32BE(addrBytes.length, 0);
      
      hookData = `0x${Buffer.concat([magic, version, lenBuf, addrBytes]).toString('hex')}` as `0x${string}`;
    } else if (destChain === 'solana') {
      // For Solana destination: mintRecipient is the recipient's USDC *token account*,
      // not their wallet — Solana's TokenMessengerMinter loads it as one directly.
      mintRecipient = solanaMintRecipientBytes32(recipientAddress);
    } else {
      mintRecipient = `0x${'0'.repeat(24)}${recipientAddress.slice(2).toLowerCase()}` as `0x${string}`;
    }


    const policyId = GAS_POLICY_IDS[sourceChain];

    const standardRpcClient = createPublicClient({
      chain: VIEM_CHAINS[sourceChain],
      transport: http(getStandardRpcUrl(sourceChain)),
    });
    const { maxFeePerGas, maxPriorityFeePerGas } = await sponsoredUserOpFees(
      bundlerClient,
      standardRpcClient,
      sourceChain,
    );

    // Calculate max fee and build callData for deposit for burn
    // Always use Fast Transfer (1000) — Standard Transfer (2000) takes 13+ minutes.
    const minFinalityThreshold = 1000;
    const maxFee = await calculateMaxFee(sourceChain, amountUSDC, destChain, minFinalityThreshold);

    const depositCallData = destChain === 'stellar'
      ? encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName: 'depositForBurnWithHook',
          args: [
            amountRaw,
            destinationDomain,
            mintRecipient,
            usdcAddress as `0x${string}`,
            destinationCaller,
            maxFee,
            minFinalityThreshold,
            hookData!
          ],
        })
      : encodeFunctionData({
          abi: TOKEN_MESSENGER_ABI,
          functionName: 'depositForBurn',
          args: [
            amountRaw,
            destinationDomain,
            mintRecipient,
            usdcAddress as `0x${string}`,
            destinationCaller,
            maxFee,
            minFinalityThreshold
          ],
        });

    // Arc takes the same two-call path as every other chain: approve the TokenMessenger
    // on the USDC ERC-20, then burn. `depositForBurn` is not payable, so the previous
    // attempt to pass the amount as native `value` reverted every Arc bridge.
    const bridgeCalls = [
      {
        to: usdcAddress as `0x${string}`,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TOKEN_MESSENGER_V2 as `0x${string}`, amountRaw],
        }),
      },
      {
        to: TOKEN_MESSENGER_V2 as `0x${string}`,
        data: depositCallData,
      },
    ];

    toast.info('Initiating bridge transfer...');
    const bridgeOpHash = await sendWithAdaptiveVerificationGas(
      sourceChain,
      (verificationGasLimit) =>
        bundlerClient.sendUserOperation({
          account,
          calls: bridgeCalls,
          maxFeePerGas,
          maxPriorityFeePerGas,
          verificationGasLimit,
          paymaster: true,
          paymasterContext: policyId ? { policyId } : undefined,
        }),
      await isAccountDeployed(account),
    );

    toast.info('Bridge transaction sent! Finalizing...');

    // 4. Return immediately with the userOp hash and a background promise for the tx hash.
    // waitForUserOperationReceipt can be slow on Arbitrum — we don't block the UI on it.
    const txHashPromise = resolveUserOpToTxHash(bundlerClient, bridgeOpHash);
    txHashPromise
      .then(() => toast.success('Bridge transaction confirmed on-chain!'))
      .catch((e) => console.warn('[SmartBridge] tx resolution failed:', e));

    return { userOpHash: bridgeOpHash, txHashPromise };
  } catch (error: unknown) {
    // Full error dump — copy from console for easy debugging
    const err = error as Record<string, unknown>;
    console.error('[SmartBridge] ❌ Execution error:', error);
    console.error('[SmartBridge] message:', err?.message);
    console.error('[SmartBridge] cause:', err?.cause);
    console.error('[SmartBridge] details:', err?.details);
    console.error('[SmartBridge] shortMessage:', err?.shortMessage);
    console.error('[SmartBridge] metaMessages:', err?.metaMessages);
    console.error('[SmartBridge] data:', err?.data);
    console.error('[SmartBridge] full JSON:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

    // Better rejection message
    const errorMsg = typeof err?.message === 'string' ? err.message : '';
    if (errorMsg.toLowerCase().includes('user rejected') || errorMsg.toLowerCase().includes('denied')) {
      toast.error('Transaction cancelled by user');
      throw new Error('User cancelled');
    }

    // Show the most descriptive message available
    const displayMsg =
      (typeof err?.shortMessage === 'string' && err.shortMessage) ||
      (typeof err?.details === 'string' && err.details) ||
      errorMsg ||
      'Bridge failed';

    toast.error(displayMsg);
    throw error;
  }
}

const MESSAGE_TRANSMITTER_ABI = [
  {
    name: 'receiveMessage',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Gaslessly submit a receiveMessage transaction on the destination chain using the
 * user's Privy smart account, minting the bridged USDC there. Used to complete CCTP
 * transfers when Circle's relayer doesn't auto-mint (non-EVM sources, and EVM→EVM
 * bridges to chains other than Base). The MessageTransmitterV2 contract shares one
 * CREATE2 address across all EVM chains, so only the bundler chain changes.
 */
const pendingClaims = new Set<string>();

export async function executeReceiveMessage(
  embeddedWallet: ConnectedWallet,
  messageHex: string,
  attestationHex: string,
  destChain: SupportedChain = HOME_CHAIN,
): Promise<string> {
  const normMessage = messageHex.toLowerCase();
  if (pendingClaims.has(normMessage)) {
    console.warn('[executeReceiveMessage] Claim already in progress for this message.');
    return 'N/A';
  }
  pendingClaims.add(normMessage);

  const MESSAGE_TRANSMITTER = MESSAGE_TRANSMITTER_V2;
  let standardRpcClient: PublicClient | null = null;

  try {
    const chainId = CHAIN_IDS[destChain];
  const chainHex = `0x${chainId.toString(16)}`;

  // 1. Attempt to switch the network via Privy ConnectedWallet API
  await embeddedWallet.switchChain(chainId).catch((err) => {
    console.warn("[executeReceiveMessage] Privy switchChain failed, fallback to provider request...", err);
  });

  // 2. Allow network switch state to propagate in the Privy iframe
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 3. Re-acquire the EIP1193 provider to fetch the updated chain configuration
  let ethereumProvider = await embeddedWallet.getEthereumProvider();

  // 4. Verify chain ID and force switch via direct EIP1193 RPC request if not matched
  const currentChainHex = await ethereumProvider.request({ method: 'eth_chainId' }).catch(() => null);
  if (currentChainHex !== chainHex) {
    console.log(`[executeReceiveMessage] Provider chain is ${currentChainHex}, forcing switch to ${chainHex}...`);
    try {
      await ethereumProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainHex }],
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      ethereumProvider = await embeddedWallet.getEthereumProvider();
    } catch (switchErr) {
      console.error("[executeReceiveMessage] Forced chain switch failed:", switchErr);
    }
  }

  // Ethereum mainnet is the one destination we cannot sponsor: Circle's modular
  // bundler answers "the specified blockchain is either not supported or deprecated"
  // for it, on every slug. The only path that ever worked was claiming directly from
  // the user's Privy EOA with the user paying L1 gas — which can cost more than the
  // transfer itself, so it is disabled rather than offered.
  //
  // L1 is filtered out of the bridge UI on both sides (see BRIDGE_DISABLED_CHAINS), so
  // this is only reachable by a burn made before that gate went in. Fail with the real
  // reason instead of falling through to the bundler's opaque "not supported" error.
  //
  // To re-enable: restore the block below *and* drop 'ethereum' from
  // BRIDGE_DISABLED_CHAINS in lib/circle/gateway.ts. Both are needed.
  if (destChain === 'ethereum') {
    throw new Error(
      'Claiming to Ethereum is temporarily unavailable. Your funds are safe and the transfer stays claimable — please contact support.',
    );

    // const { createWalletClient, custom } = await import('viem');
    // const [eoaAddress] = await ethereumProvider.request({
    //   method: 'eth_requestAccounts',
    // }) as `0x${string}`[];
    //
    // const walletClient = createWalletClient({
    //   chain: VIEM_CHAINS[destChain],
    //   transport: custom(ethereumProvider),
    // });
    //
    // const hash = await walletClient.writeContract({
    //   address: MESSAGE_TRANSMITTER as `0x${string}`,
    //   abi: MESSAGE_TRANSMITTER_ABI,
    //   functionName: 'receiveMessage',
    //   args: [
    //     (messageHex.startsWith('0x') ? messageHex : `0x${messageHex}`) as `0x${string}`,
    //     (attestationHex.startsWith('0x') ? attestationHex : `0x${attestationHex}`) as `0x${string}`,
    //   ],
    //   account: eoaAddress,
    // });
    // return hash;
  }

  // getCircleClient calls eth_requestAccounts internally — Privy providers can return []
  // on the first call if the wallet is still initialising. Retry once after a short delay.
  let circleResult: Awaited<ReturnType<typeof getCircleClient>>;
  try {
    circleResult = await getCircleClient(ethereumProvider, destChain);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('no accounts')) {
      console.warn('[executeReceiveMessage] Privy wallet not ready, retrying in 2s…');
      await new Promise((r) => setTimeout(r, 2000));
      const freshProvider = await embeddedWallet.getEthereumProvider();
      circleResult = await getCircleClient(freshProvider, destChain);
    } else {
      throw err;
    }
  }
  const { bundlerClient, account } = circleResult;

  // Normalize hex strings — Circle Iris API may return them without 0x prefix
  const normalizedMessage = (messageHex.startsWith('0x') ? messageHex : `0x${messageHex}`) as `0x${string}`;
  const normalizedAttestation = (attestationHex.startsWith('0x') ? attestationHex : `0x${attestationHex}`) as `0x${string}`;


  // Use gas policy if one exists for the dest chain, otherwise rely on
  // Circle's default paymaster (no context needed — works on Base).
  const policyId = GAS_POLICY_IDS[destChain];

  standardRpcClient = createPublicClient({
    chain: VIEM_CHAINS[destChain],
    transport: rpcTransport(destChain),
  });

  const isProcessed = await isMessageDelivered(
    standardRpcClient,
    normalizedMessage,
    MESSAGE_TRANSMITTER,
  );

  if (isProcessed) {
    console.log('[executeReceiveMessage] Message already processed on-chain.');
    const mintTx = await findMintTxHash(standardRpcClient, normalizedMessage, MESSAGE_TRANSMITTER);
    if (mintTx) return mintTx;
    return 'N/A'; // fallback mock hash
  }
  // Same underpricing that stalled the burn side would strand a claim — and a stalled
  // claim is worse, because the USDC is already burned by then.
  const { maxFeePerGas, maxPriorityFeePerGas } = await sponsoredUserOpFees(
    bundlerClient,
    standardRpcClient,
    destChain,
  );

    // A claim is very often a wallet's first ever transaction on the destination chain —
    // the bridge is what puts funds there in the first place — so this is the common
    // case, not an edge case.
    const deployed = await isAccountDeployed(account);
    if (!deployed) {
      console.log(
        `[executeReceiveMessage] Smart account is not yet deployed on ${destChain}; ` +
          'the claim will deploy it as part of the same userOperation.',
      );
    }

    const userOpHash = await sendWithAdaptiveVerificationGas(
      destChain,
      (verificationGasLimit) =>
        bundlerClient.sendUserOperation({
          account,
          calls: [
            {
              to: MESSAGE_TRANSMITTER as `0x${string}`,
              data: encodeFunctionData({
                abi: MESSAGE_TRANSMITTER_ABI,
                functionName: 'receiveMessage',
                args: [normalizedMessage, normalizedAttestation],
              }),
            },
          ],
          maxFeePerGas,
          maxPriorityFeePerGas,
          verificationGasLimit,
          paymaster: true,
          ...(policyId ? { paymasterContext: { policyId } } : {}),
        }),
      deployed,
    );

    // Poll both standard RPC client (processedMessages) and bundler client (with timeout) for instant, hang-free resolution
    const deadline = Date.now() + 15_000; // Poll for max 15 seconds to avoid freezing the UI
    while (Date.now() < deadline) {
      const receipt = await withTimeout(
        bundlerClient.getUserOperationReceipt({ hash: userOpHash }),
        2000
      ).catch(() => null);

      if (receipt?.receipt?.transactionHash) {
        return receipt.receipt.transactionHash;
      }

      const isProcessedNow = await isMessageDelivered(
        standardRpcClient,
        normalizedMessage,
        MESSAGE_TRANSMITTER,
      );

      if (isProcessedNow) {
        // Delivered — but a userOpHash is not a transaction hash, and storing one puts a
        // value in mint_tx_hash that no explorer will resolve. Find the real one.
        const mintTx = await findMintTxHash(standardRpcClient, normalizedMessage, MESSAGE_TRANSMITTER);
        if (mintTx) return mintTx;
      }

      await new Promise((r) => setTimeout(r, 2000));
    }

    // The fast poll is capped so the UI doesn't freeze, but giving up there is what left
    // rows holding a userOpHash. Spend a little longer on the authoritative source (the
    // bundler receipt), then fall back to the delivery log.
    console.log('[executeReceiveMessage] Fast poll elapsed; resolving the real mint tx hash…');
    const resolved = await resolveUserOpToTxHash(bundlerClient, userOpHash, 45_000).catch(
      () => null,
    );
    if (resolved) return resolved;

    const recovered = await findMintTxHash(standardRpcClient, normalizedMessage, MESSAGE_TRANSMITTER);
    if (recovered) return recovered;

    // 'N/A' means "delivered, hash unknown" — a *success* to every caller, which then
    // marks the bridge complete and tells the user their USDC has arrived. So it may
    // only be returned once the chain confirms the mint actually happened. Returning it
    // unconditionally is what made a silently-stalled claim look like a finished bridge:
    // the op was never mined, nothing arrived, and the UI still said "Bridge complete".
    //
    // Never return `userOpHash` here either — a userOp hash is not a transaction hash,
    // and storing one puts a value in mint_tx_hash that no explorer will resolve.
    if (await isMessageDelivered(standardRpcClient, normalizedMessage, MESSAGE_TRANSMITTER)) {
      console.warn('[executeReceiveMessage] Delivered, but the mint tx hash is not resolvable yet.');
      return 'N/A';
    }

    // Not delivered. The burn and its attestation stay valid forever, so this is a retry,
    // not a loss — say so plainly and let the caller surface it.
    // Kept short and plain: `classifyAppError` rewrites anything over 120 characters as
    // "Something went wrong", so a longer message would never reach the user.
    throw new Error(
      `Claim not confirmed on ${destChain} yet. Your USDC is safe — please try again.`,
    );
  } catch (error) {
    if (standardRpcClient) {
      const isProcessedNow = await isMessageDelivered(
        standardRpcClient,
        messageHex,
        MESSAGE_TRANSMITTER,
      );

      if (isProcessedNow) {
        console.log('[executeReceiveMessage] UserOperation reverted because message is already processed. Recovering mint hash...');
        const mintTx = await findMintTxHash(standardRpcClient, messageHex, MESSAGE_TRANSMITTER);
        if (mintTx) return mintTx;
        return 'N/A';
      }
    }
    throw error;
  } finally {
    pendingClaims.delete(normMessage);
  }
}

/**
 * Bridge USDC from one chain to another and deliver it straight to `recipient` on the
 * destination, end to end. Used by the external-address transfer flow when the user's
 * funds are on a different chain than the recipient.
 *
 * CCTP's mintRecipient is the recipient itself, so no separate transfer is needed. The
 * burn and mint live on different chains separated by Circle's attestation, so this
 * cannot be a single transaction — it burns on the source, waits for the attestation,
 * then mints on the destination (Circle's relayed mint if present, else submits
 * `receiveMessage` itself).
 *
 * Resolves once the destination mint is in flight; rejects only if the burn fails.
 */
export async function bridgeAndDeliver(
  embeddedWallet: ConnectedWallet,
  params: {
    sourceChain: SupportedChain;
    destChain: SupportedChain;
    amountUSDC: string;
    recipient: string;
    onStatus?: (status: string) => void;
    timeoutMs?: number;
  },
): Promise<{ burnTxHash: string; mintTxHash?: string }> {
  const { sourceChain, destChain, amountUSDC, recipient, onStatus } = params;
  const timeoutMs = params.timeoutMs ?? 20 * 60_000;

  onStatus?.(`Bridging from ${sourceChain}…`);
  const { txHashPromise } = await executeSmartBridge(
    embeddedWallet,
    sourceChain,
    amountUSDC,
    recipient,
    destChain,
  );
  const burnTxHash = await txHashPromise;

  onStatus?.('Waiting for network confirmation…');
  let attestationData: AttestationResponse | null = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/bridge/status?txHash=${burnTxHash}&sourceChain=${sourceChain}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'complete') {
          attestationData = data;
          break;
        }
      }
    } catch (err) {
      console.warn('[bridgeAndDeliver] status poll error:', err);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }

  if (!attestationData) {
    throw new Error('Bridge attestation timed out');
  }

  const MESSAGE_TRANSMITTER = MESSAGE_TRANSMITTER_V2;

  let mintTxHash: string | undefined = attestationData.mintTxHash;
  if (!mintTxHash && attestationData.attestation && attestationData.messageBytes) {
    const standardRpcClient = createPublicClient({
      chain: VIEM_CHAINS[destChain],
      transport: rpcTransport(destChain),
    });
    const isProcessed = await isMessageDelivered(
      standardRpcClient,
      attestationData.messageBytes,
      MESSAGE_TRANSMITTER,
    );

    if (isProcessed) {
      console.log('[bridgeAndDeliver] Message already processed on-chain. Skipping manual claim popup.');
      mintTxHash = await findMintTxHash(standardRpcClient, attestationData.messageBytes, MESSAGE_TRANSMITTER);
      if (!mintTxHash) {
        mintTxHash = 'N/A';
      }
    } else {
      onStatus?.(`Delivering on ${destChain}…`);
      mintTxHash = await executeReceiveMessage(
        embeddedWallet,
        attestationData.messageBytes,
        attestationData.attestation,
        destChain,
      );
    }
  }

  return { burnTxHash, mintTxHash };
}

/**
 * Move enough USDC onto `targetChain` to cover `requiredAmount`, by bridging from the
 * user's other chains (largest balances first, to minimise the number of hops). Used by
 * batch and off-ramp flows when funds are too fragmented to complete on a single chain.
 *
 * Bridges run sequentially and each waits for CCTP settlement, so this can take several
 * minutes. A 1% buffer is added to absorb CCTP fees. No-op if the target already holds
 * enough.
 */
export async function consolidateFundsToChain(
  embeddedWallet: ConnectedWallet,
  params: {
    targetChain: SupportedChain;
    requiredAmount: string;
    /**
     * What the caller will actually spend afterwards, if that differs from
     * `requiredAmount`. Callers pad `requiredAmount` to size the bridges generously
     * (withdrawal adds 0.3%, batch 0.1%); the padding is headroom, not a requirement, so
     * confirming against it would fail a near-max transfer that would have gone through.
     * Defaults to `requiredAmount`.
     */
    confirmAmount?: string;
    balances: ChainBalances;
    recipient: string;
    onStatus?: (status: string) => void;
    /** Optional Solana source — drawn from last (only when target is Base). */
    solana?: SolanaSource;
    /** Optional Stellar source — drawn from last (only when target is Base). */
    stellar?: {
      walletId: string;
      address: string;
      balance: number;
      bridgeToBase: (amount: string, recipient: string, onStatus?: (status: string) => void) => Promise<void>;
    };
  },
): Promise<void> {
  const { targetChain, requiredAmount, balances, recipient, onStatus, solana, stellar } = params;
  const required = parseFloat(requiredAmount) || 0;
  const have = balances[targetChain] ?? 0;
  let remaining = (required - have) * 1.01; // 1% buffer for CCTP fees
  if (remaining <= 0) return;

  interface UnifiedSource {
    type: 'evm' | 'solana' | 'stellar';
    chain: SourceChainKey;
    balance: number;
  }

  const allSources: UnifiedSource[] = [];

  // Add EVM sources (excluding target chain)
  for (const c of EVM_CHAINS) {
    if (c !== targetChain && (balances[c] ?? 0) > 0) {
      allSources.push({ type: 'evm', chain: c, balance: balances[c]! });
    }
  }

  // Solana and Stellar can only be pulled in when the target is the settlement chain —
  // those rails bridge into it, not to an arbitrary chain.
  if (targetChain === HOME_CHAIN && solana && solana.balance > 0) {
    allSources.push({ type: 'solana', chain: 'solana', balance: solana.balance });
  }

  if (targetChain === HOME_CHAIN && stellar && stellar.balance > 0) {
    allSources.push({ type: 'stellar', chain: 'stellar', balance: stellar.balance });
  }

  // Sort all sources descending by balance
  allSources.sort((a, b) => b.balance - a.balance);

  for (const source of allSources) {
    if (remaining <= 0) break;
    const take = Math.min(source.balance, remaining);
    if (take <= 0) continue;

    if (source.type === 'evm') {
      const evmChain = source.chain as SupportedChain;
      onStatus?.(`Moving funds from ${CHAIN_NAMES[evmChain]} to ${CHAIN_NAMES[targetChain]}…`);
      await bridgeAndDeliver(embeddedWallet, {
        sourceChain: evmChain,
        destChain: targetChain,
        amountUSDC: take.toFixed(6),
        recipient,
        onStatus,
      });
    } else if (source.type === 'solana' && solana) {
      onStatus?.(`Moving funds from Solana to ${CHAIN_NAMES[targetChain]}…`);
      await solana.bridgeToBase(take.toFixed(6), recipient, onStatus);
    } else if (source.type === 'stellar' && stellar) {
      onStatus?.(`Moving funds from Stellar to ${CHAIN_NAMES[targetChain]}…`);
      await stellar.bridgeToBase(take.toFixed(6), recipient, onStatus);
    }
    remaining -= take;
  }

  onStatus?.(`Confirming funds on ${CHAIN_NAMES[targetChain]}…`);
  await waitForConsolidatedBalance(
    targetChain,
    recipient,
    parseFloat(params.confirmAmount ?? requiredAmount) || 0,
    onStatus,
  );
}

/**
 * Block until the target chain actually shows the money.
 *
 * Every caller of `consolidateFundsToChain` spends the funds immediately afterwards, and
 * until now that was a race it usually won by luck. `bridgeAndDeliver` resolves once the
 * destination mint is *in flight* — Circle's relayer may still be submitting it, and even
 * a landed mint takes a block to become readable. Spending against a balance that hasn't
 * appeared yet fails as an ERC-20 transfer revert, which tells the user nothing and, in
 * the p2p flow, happens after their funds have already left the source chain.
 *
 * CCTP also charges a fee on every hop, taken out of the amount bridged. Consolidating a
 * user's *entire* balance therefore always lands a few micro-USDC short of the request —
 * the 1% buffer above cannot cover it, because there is nothing left to take the buffer
 * from. No amount of waiting fixes that, so it is reported as what it is (send slightly
 * less) rather than left to surface as an ERC-20 revert further down the flow.
 *
 * The comparison is exact for that reason: a "close enough" tolerance here just moves the
 * revert one step later, since the caller goes on to spend the full requested amount.
 */
async function waitForConsolidatedBalance(
  targetChain: SupportedChain,
  address: string,
  required: number,
  onStatus?: (status: string) => void,
  timeoutMs = 90_000,
): Promise<void> {
  const client = createPublicClient({
    chain: VIEM_CHAINS[targetChain],
    transport: rpcTransport(targetChain),
  });
  const usdc = USDC_ADDRESSES[targetChain] as `0x${string}`;
  const requiredRaw = parseUnits(required.toFixed(6), 6);

  const deadline = Date.now() + timeoutMs;
  let latest = 0n;
  while (Date.now() < deadline) {
    latest = await client
      .readContract({
        address: usdc,
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [address as `0x${string}`],
      })
      .catch(() => latest);

    if (latest >= requiredRaw) return;
    onStatus?.(
      `Confirming funds on ${CHAIN_NAMES[targetChain]} ` +
        `(${(Number(latest) / 1e6).toFixed(2)} of ${required.toFixed(2)} USDC)…`,
    );
    await new Promise((r) => setTimeout(r, 5_000));
  }

  console.warn(
    `[Consolidate] ${CHAIN_NAMES[targetChain]} settled at ${latest} of ${requiredRaw} ` +
      `micro-USDC for ${address}.`,
  );
  throw new Error(
    `Bridge fees left you just short on ${CHAIN_NAMES[targetChain]}. Please send a slightly smaller amount.`,
  );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}
