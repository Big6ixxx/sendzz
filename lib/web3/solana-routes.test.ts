import { Buffer } from 'buffer';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { isUnsupportedBridgePair, planWithdrawalRoute } from './routing';
import { consolidateFundsToChain, selectConsolidationSources } from './bridge-actions';
import { claimBridgeOnDestination } from './bridge-claim';
import type { ConnectedWallet } from '@privy-io/react-auth';

describe('isUnsupportedBridgePair', () => {
  it('refuses Solana ↔ Stellar in both directions', () => {
    expect(isUnsupportedBridgePair('solana', 'stellar')).toBe(true);
    expect(isUnsupportedBridgePair('stellar', 'solana')).toBe(true);
  });

  it('allows every pair that goes through an EVM chain', () => {
    expect(isUnsupportedBridgePair('solana', 'base')).toBe(false);
    expect(isUnsupportedBridgePair('base', 'solana')).toBe(false);
    expect(isUnsupportedBridgePair('stellar', 'polygon')).toBe(false);
    expect(isUnsupportedBridgePair('arbitrum', 'stellar')).toBe(false);
  });
});

describe('selectConsolidationSources', () => {
  it('never routes Solana into Stellar, even when Solana holds the most', () => {
    const picked = selectConsolidationSources({
      targetChain: 'stellar',
      requiredAmount: '50',
      balances: { base: 30 },
      solanaBalance: 100,
      stellarBalance: 0,
    });
    expect(picked.map((p) => p.chain)).toEqual(['base']);
  });

  it('never routes Stellar into Solana', () => {
    const picked = selectConsolidationSources({
      targetChain: 'solana',
      requiredAmount: '50',
      balances: { base: 30 },
      stellarBalance: 100,
    });
    expect(picked.map((p) => p.chain)).toEqual(['base']);
  });

  it('still uses Solana for an EVM target', () => {
    const picked = selectConsolidationSources({
      targetChain: 'base',
      requiredAmount: '50',
      balances: {},
      solanaBalance: 100,
    });
    expect(picked.map((p) => p.chain)).toEqual(['solana']);
  });
});

describe('planWithdrawalRoute consolidation target', () => {
  it('does not pick Solana as the target, even as the largest balance', () => {
    const plan = planWithdrawalRoute(
      '100',
      { base: 40, solana: 60 },
      { supportedChains: ['base', 'solana'] },
    );
    expect(plan.needsConsolidation).toBe(true);
    expect(plan.chain).toBe('base');
  });

  it('still settles directly on Solana when it covers the whole amount', () => {
    const plan = planWithdrawalRoute('50', { base: 10, solana: 60 }, { supportedChains: ['base', 'solana'] });
    expect(plan).toMatchObject({ feasible: true, chain: 'solana' });
  });
});

describe('consolidateFundsToChain onto Solana', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses before burning anything when there is no Solana wallet to deliver into', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const wallet = { getEthereumProvider: vi.fn() } as unknown as ConnectedWallet;

    await expect(
      consolidateFundsToChain(wallet, {
        targetChain: 'solana',
        requiredAmount: '50',
        balances: { base: 100 },
        recipient: '0x' + '11'.repeat(20),
        solanaWallet: null,
      }),
    ).rejects.toThrow(/not available/);
    expect(wallet.getEthereumProvider).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('claimBridgeOnDestination on Solana', () => {
  afterEach(() => vi.unstubAllGlobals());

  const claim = () =>
    claimBridgeOnDestination({
      destChain: 'solana',
      messageBytes: '0x00',
      attestation: '0x00',
      solanaWallet: { address: 'So1anaAddre55' },
      burnTxHash: 'burn',
      sourceChain: 'base',
    });

  const respond = (body: unknown, ok = true) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

  it('treats a claim that is still confirming as NOT delivered', async () => {
    respond({ txHash: 'sig', pending: true });
    await expect(claim()).rejects.toThrow(/still confirming/);
  });

  it('returns the mint signature for a confirmed claim', async () => {
    respond({ txHash: 'sig' });
    await expect(claim()).resolves.toBe('sig');
  });

  it('returns the recovered mint for an already-delivered claim', async () => {
    respond({ alreadyClaimed: true, txHash: 'earlier' });
    await expect(claim()).resolves.toBe('earlier');
  });

  it('returns undefined for an already-delivered claim with no recoverable mint', async () => {
    respond({ alreadyClaimed: true, txHash: null });
    await expect(claim()).resolves.toBeUndefined();
  });

  it('carries the error code so an expired attestation is classified', async () => {
    respond({ error: 'This transfer must be re-signed', code: 'attestation_expired' }, false);
    await expect(claim()).rejects.toThrow(/must be re-signed attestation_expired/);
  });
});

describe('prepareSolanaBurnTx with a platform fee', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds a burn the sponsor policy accepts, fee to the treasury in the same transaction', async () => {
    const { Keypair, Transaction } = await import('@solana/web3.js');
    const { getAssociatedTokenAddressSync } = await import('@solana/spl-token');
    const { SOLANA_USDC_MINT } = await import('@/lib/circle/solana-gateway');
    const { checkSponsoredBurn } = await import('@/lib/solana/sponsor-policy');
    const { prepareSolanaBurnTx } = await import('./solana-bridge');

    const owner = Keypair.generate().publicKey;
    const feePayer = Keypair.generate().publicKey;
    const treasury = Keypair.generate().publicKey;
    const connection = {
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 99,
      }),
      getAccountInfo: async () => ({}), // the treasury's token account exists
    };

    let sent: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (url === '/api/bridge/solana-sponsor') {
          sent = JSON.parse(init!.body!).transaction;
          return { ok: false, statusText: 'stop here', json: async () => ({}) };
        }
        return { ok: false, statusText: 'no fees', json: async () => ({}) };
      }),
    );

    await expect(
      prepareSolanaBurnTx({
        connection: connection as never,
        walletAddress: owner.toBase58(),
        amount: '10',
        recipientEvm: '0x' + '11'.repeat(20),
        platformFee: { usdc: '0.050000', treasury: treasury.toBase58() },
      }),
    ).rejects.toThrow(/Gas station error/);

    const tx = Transaction.from(Buffer.from(sent!, 'base64'));
    expect(checkSponsoredBurn(tx, { feePayer, owner, feeTreasury: treasury })).toEqual({ ok: true });
    // And the fee really is there, to the treasury's token account.
    const treasuryAta = getAssociatedTokenAddressSync(SOLANA_USDC_MINT, treasury, true);
    expect(tx.instructions.some((ix) => ix.keys[2]?.pubkey.equals(treasuryAta))).toBe(true);
    // Without a treasury the server refuses it, rather than letting a fee go elsewhere.
    expect(checkSponsoredBurn(tx, { feePayer, owner, feeTreasury: null }).ok).toBe(false);
  });

  it('refuses before the burn when the treasury has no USDC account', async () => {
    const { Keypair } = await import('@solana/web3.js');
    const { prepareSolanaBurnTx } = await import('./solana-bridge');
    const fetchSpy = vi.fn(async (_url: string) => ({ ok: false, statusText: "x", json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(
      prepareSolanaBurnTx({
        connection: {
          getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
          getAccountInfo: async () => null,
        } as never,
        walletAddress: Keypair.generate().publicKey.toBase58(),
        amount: '10',
        recipientEvm: '0x' + '11'.repeat(20),
        platformFee: { usdc: '0.05', treasury: Keypair.generate().publicKey.toBase58() },
      }),
    ).rejects.toThrow(/unavailable/);
    expect(fetchSpy.mock.calls.some(([url]) => url === '/api/bridge/solana-sponsor')).toBe(false);
  });
});
