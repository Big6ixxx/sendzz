import { ChainLogo } from '@/components/deposit-withdraw/ChainLogo';
import { formatFeeSummary } from '@/lib/format-usdc';
import { usePlatformFeePercent } from '@/lib/hooks/usePlatformFeePercent';
import React from 'react';
import { SupportedChain } from '@/lib/circle/gateway';
import { SourceSelector } from '@/components/SourceSelector';
import type { ChainBalances, SourcePreference } from '@/lib/web3/routing';
import { AmountField, AsideFigure, AsideRows, CurrencyPill, FlowButton, FlowInput, FlowPage, FlowLabel } from '@/components/flow/ui';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface CryptoTransferFormProps {
  recipientAddress: string;
  setRecipientAddress: (address: string) => void;
  amount: string;
  setAmount: (amount: string) => void;
  selectedChain: SupportedChain | 'stellar' | 'solana';
  setSelectedChain: (chain: SupportedChain | 'stellar' | 'solana') => void;
  memo: string;
  setMemo: (memo: string) => void;
  loading: boolean;
  status: string;
  balance: string;
  isFetchingBalance: boolean;
  isOverBalance: boolean;
  spendable: number;
  isZeroBalance: boolean;
  /** Stellar is opt-in: it is only listed once the user has activated it. */
  stellarReady: boolean;
  handleTransfer: (e: React.FormEvent) => void;
  sourcePref: SourcePreference;
  setSourcePref: (p: SourcePreference) => void;
  chainBalances: ChainBalances;
  solanaBalance: number;
  /** The email-or-wallet choice, shown above the form. */
  tabs: React.ReactNode;
  /** Cards under the summary. */
  extra?: React.ReactNode;
}

// Ethereum L1 commented out — see BRIDGE_DISABLED_CHAINS in lib/circle/gateway.
const AVAILABLE_CHAINS: (SupportedChain | 'stellar' | 'solana')[] = [
  'base',
  // 'ethereum',
  'arbitrum',
  'optimism',
  'polygon',
  'avalanche',
  'arc',
  'stellar',
  'solana',
];

const ALL_CHAIN_NAMES: Record<SupportedChain | 'stellar' | 'solana', string> = {
  base: 'Base',
  ethereum: 'Ethereum',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  arc: 'Arc',
  stellar: 'Stellar',
  solana: 'Solana',
};

export function CryptoTransferForm({
  recipientAddress,
  setRecipientAddress,
  amount,
  setAmount,
  selectedChain,
  setSelectedChain,
  memo,
  setMemo,
  loading,
  status,
  balance,
  isFetchingBalance,
  isOverBalance,
  spendable,
  isZeroBalance,
  stellarReady,
  handleTransfer,
  sourcePref,
  setSourcePref,
  chainBalances,
  solanaBalance,
  tabs,
  extra,
}: CryptoTransferFormProps) {
  const transferFeePercent = usePlatformFeePercent("transfer");
  const fundedSources =
    Object.values(chainBalances).filter((b) => (b ?? 0) > 0).length +
    (solanaBalance > 0 ? 1 : 0);
  const formId = React.useId();
  const amt = parseFloat(amount || '0');
  // What actually leaves the wallet. The fee is charged on-chain in the same transaction,
  // so showing it here is the only place the user learns about it before it's taken.
  const fee =
    amt > 0 && transferFeePercent !== null
      ? formatFeeSummary(amt, (amt * transferFeePercent) / 100, amt * (1 + transferFeePercent / 100))
      : null;
  const chainName = ALL_CHAIN_NAMES[selectedChain];

  return (
    <FlowPage
      tabs={tabs}
      main={
        <form id={formId} onSubmit={handleTransfer} className="space-y-5 animate-in fade-in duration-300">
          <div>
            <FlowLabel>Network the address is on</FlowLabel>
            <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Network">
              {AVAILABLE_CHAINS.filter((c) => c !== 'stellar' || stellarReady).map((chain) => (
                <button
                  key={chain}
                  type="button"
                  role="radio"
                  aria-checked={selectedChain === chain}
                  onClick={() => setSelectedChain(chain)}
                  className={cn(
                    'flex items-center gap-2 whitespace-nowrap rounded-full py-1.5 pl-1.5 pr-3.5 text-[14px] font-semibold transition-colors duration-150',
                    selectedChain === chain
                      ? 'bg-[var(--lp-ink)] text-[var(--lp-cream)]'
                      : 'bg-[var(--lp-surface)] shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.08)] hover:shadow-[0_0_0_1px_rgb(var(--lp-hair)/0.3)]',
                  )}
                >
                  <ChainLogo chain={chain} size={22} />
                  {ALL_CHAIN_NAMES[chain]}
                </button>
              ))}
            </div>
          </div>

          <FlowInput
            label="Wallet address"
            type="text"
            value={recipientAddress}
            onChange={(e) => setRecipientAddress(e.target.value)}
            className="lp-mono text-[15px]"
            placeholder={selectedChain === 'stellar' ? 'G…' : selectedChain === 'solana' ? 'Solana address' : '0x…'}
            required
            autoComplete="off"
            spellCheck={false}
            hint={`Only send to an address on ${chainName}. A wrong network can lose the money for good.`}
          />

          {selectedChain === 'stellar' && (
            <FlowInput
              label="Memo (optional)"
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Up to 28 characters"
              maxLength={28}
              autoComplete="off"
              hint="Exchanges often need one. Copy it exactly from them."
            />
          )}

          <AmountField
            label="How much"
            value={amount}
            onChange={setAmount}
            symbol="$"
            currency={<CurrencyPill>USDC</CurrencyPill>}
            placeholder="0.00"
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-[var(--lp-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  On {chainName}:{' '}
                  {isFetchingBalance ? <Skeleton className="inline-block h-3.5 w-20 align-middle" aria-label="Loading balance" /> : `${parseFloat(balance).toFixed(2)} USDC`}
                </span>
                {spendable > 0 && (
                  <button
                    type="button"
                    disabled={transferFeePercent === null}
                    // Everything the router can reach, less the fee — matching the balance check.
                    // Previously this filled in the selected chain's balance, which with a fee on
                    // top immediately exceeded that chain and forced a pointless consolidation.
                    onClick={() => {
                      if (transferFeePercent === null) return;
                      const max = spendable / (1 + transferFeePercent / 100);
                      setAmount((Math.floor(max * 1e6) / 1e6).toString());
                    }}
                    className="rounded-full bg-[var(--lp-cream)] px-3 py-1 text-[13px] font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-sand)] disabled:text-[var(--lp-muted)]"
                  >
                    Use max
                  </button>
                )}
              </div>
            }
          />

          {amt > 0 && fundedSources > 1 && (
            <SourceSelector
              balances={chainBalances}
              solanaBalance={solanaBalance}
              requiredAmount={amt}
              allowConsolidate
              value={sourcePref}
              onChange={setSourcePref}
            />
          )}
        </form>
      }
      summary={
        <>
          <AsideFigure label="They receive" value={`$${fee ? fee.amount : amt > 0 ? amt.toFixed(2) : '0.00'}`} unit="USDC" />
          <div className="mt-5">
            <AsideRows
              rows={[
                {
                  label: 'Network',
                  value: (
                    <span className="inline-flex items-center gap-2">
                      <ChainLogo chain={selectedChain} size={18} />
                      {chainName}
                    </span>
                  ),
                },
                ...(fee
                  ? [
                      { label: `Fee (${transferFeePercent}%)`, value: `${fee.fee} USDC` },
                      { label: 'From your balance', value: `${fee.total} USDC` },
                    ]
                  : []),
              ]}
            />
          </div>
        </>
      }
      action={
        <>
          <FlowButton
            type="submit"
            form={formId}
            tone="accent"
            loading={loading}
            disabled={isZeroBalance || isOverBalance || !recipientAddress || isFetchingBalance}
          >
            {isZeroBalance
              ? 'No balance to send'
              : isOverBalance
                ? // Now means "more than you hold anywhere", not "more than this one chain" — the
                  // router gathers from other networks when a single chain doesn't cover it.
                  'More than your total balance'
                : amt > 0
                  ? `Send $${fee ? fee.amount : amt.toFixed(2)}`
                  : 'Send'}
          </FlowButton>
          {status && <p className="text-center text-[13px] leading-[1.5] text-[#cfe0d6] animate-in fade-in duration-300">{status}</p>}
        </>
      }
      extra={extra}
    />
  );
}
