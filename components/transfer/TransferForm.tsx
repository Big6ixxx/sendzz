import React from 'react';
import { SigningProgress } from "@/components/signing/SigningProgress";
import { type SigningPlan } from "@/lib/signing/plan";
import { CurrencySelector } from '@/components/CurrencySelector';
import { getCurrencySymbol, type FiatCurrencyCode } from '@/lib/currency-config';
import { type ContactRow } from '@/lib/supabase/contacts';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { ReceiptData } from '@/lib/receipt/types';
import { type RecipientCheckState } from './useTransfer';
import { RecipientSuggestions } from '@/components/contacts/RecipientSuggestions';
import { SourceSelector } from '@/components/SourceSelector';
import type { ChainBalances, SourcePreference } from '@/lib/web3/routing';
import { AmountField, AsideFigure, AsideRows, FlowButton, FlowInput, FlowPage, Notice } from '@/components/flow/ui';
import { shortenDetail } from '@/components/dashboard/activity-look';

interface TransferFormProps {
  recipientEmail: string;
  setRecipientEmail: (email: string) => void;
  amount: string;
  setAmount: (amount: string) => void;
  currency: 'USD' | FiatCurrencyCode;
  setCurrency: (currency: 'USD' | FiatCurrencyCode) => void;
  memo: string;
  setMemo: (memo: string) => void;
  loading: boolean;
  status: string;
  showSuggestions: boolean;
  setShowSuggestions: (show: boolean) => void;
  setIsAddingContact: (add: boolean) => void;
  contacts: ContactRow[];
  amountUsdc: string;
  isFiat: boolean;
  exchangeRate: number;
  isOverBalance: boolean;
  isZeroBalance: boolean;
  handleTransfer: (e: React.FormEvent) => void;
  smartAddress: string;
  balance: string;
  lastCompletedTransfer?: ReceiptData | null;
  recipientCheck?: RecipientCheckState | null;
  sourcePref: SourcePreference;
  setSourcePref: (p: SourcePreference) => void;
  chainBalances: ChainBalances;
  solanaBalance: number;
  /** The multi-step plan being worked through, when there is one. */
  activePlan?: SigningPlan | null;
  activeStep?: number;
  /** The email-or-wallet choice, shown above the form. */
  tabs: React.ReactNode;
  /** Cards under the summary. */
  extra?: React.ReactNode;
}

export function TransferForm({
  recipientEmail,
  setRecipientEmail,
  amount,
  setAmount,
  currency,
  setCurrency,
  memo,
  setMemo,
  loading,
  status,
  showSuggestions,
  setShowSuggestions,
  setIsAddingContact,
  contacts,
  amountUsdc,
  isFiat,
  exchangeRate,
  isOverBalance,
  isZeroBalance,
  handleTransfer,
  activePlan,
  activeStep = 0,
  smartAddress,
  balance,
  lastCompletedTransfer,
  recipientCheck,
  sourcePref,
  setSourcePref,
  chainBalances,
  solanaBalance,
  tabs,
  extra,
}: TransferFormProps) {
  const fundedSources =
    Object.values(chainBalances).filter((b) => (b ?? 0) > 0).length +
    (solanaBalance > 0 ? 1 : 0);
  const formId = React.useId();
  const usdc = parseFloat(amountUsdc || '0');
  const symbol = currency === 'USD' ? '$' : getCurrencySymbol(currency);
  const email = recipientEmail.trim();

  return (
    <FlowPage
      tabs={tabs}
      main={
        <form id={formId} onSubmit={handleTransfer} className="space-y-5 animate-in fade-in duration-300">
          <div className="relative z-50">
            <FlowInput
              label="Who are you paying?"
              type="email"
              value={recipientEmail}
              onChange={(e) => {
                setRecipientEmail(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              placeholder="name@example.com"
              required
              autoComplete="off"
              hint="Anyone with an email, even if they're new to Sendzz."
            />
            <RecipientSuggestions
              isOpen={showSuggestions}
              inputVal={recipientEmail}
              contacts={contacts}
              actionIcon="send"
              onSelect={(email) => {
                setRecipientEmail(email);
                setShowSuggestions(false);
              }}
              onAddNew={() => {
                setIsAddingContact(true);
                setShowSuggestions(false);
              }}
              onClose={() => setShowSuggestions(false)}
            />
          </div>

          {/* Recipient warnings — shown after 500ms debounce check */}
          {recipientCheck?.status === 'done' && recipientCheck.priorTransactionCount === 0 && (
            <Notice tone="warning" title="You haven't paid this address before">
              Check it letter by letter before you send.
            </Notice>
          )}

          <AmountField
            label="How much"
            value={amount}
            onChange={setAmount}
            symbol={symbol}
            currency={<CurrencySelector selected={currency} onChange={setCurrency} />}
            placeholder="0.00"
            footer={
              <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-[var(--lp-muted)]">
                <span>
                  {isFiat && exchangeRate > 0
                    ? `≈ $${amountUsdc} USDC · 1 USD = ${exchangeRate.toFixed(0)} ${currency}`
                    : `Available $${parseFloat(balance).toFixed(2)}`}
                </span>
                {parseFloat(balance) > 0 && (currency === 'USD' || exchangeRate > 0) && (
                  <button
                    type="button"
                    // In another currency, the whole balance converted and rounded down, so rounding
                    // can never put the amount a fraction over what is there.
                    onClick={() =>
                      setAmount(currency === 'USD' ? balance : (Math.floor(parseFloat(balance) * exchangeRate * 100) / 100).toFixed(2))
                    }
                    className="rounded-full bg-[var(--lp-cream)] px-3 py-1 text-[13px] font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-sand)]"
                  >
                    Use max
                  </button>
                )}
              </div>
            }
          />

          <FlowInput
            label="Note (optional)"
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What's it for?"
          />

          {usdc > 0 && fundedSources > 1 && (
            <SourceSelector
              balances={chainBalances}
              solanaBalance={solanaBalance}
              requiredAmount={usdc}
              value={sourcePref}
              onChange={setSourcePref}
            />
          )}

          {/* A send that only takes one step keeps the plain status line — a tracker for one
              step is noise. Anything longer shows where it has got to, because the gap between
              two confirmations is exactly where a spinner stops being reassuring. */}
          {activePlan && activePlan.steps.length > 1 && (
            <SigningProgress plan={activePlan} current={activeStep} status={status} />
          )}

          {lastCompletedTransfer && (
            <Notice tone="success" title="Sent." action={<ReceiptActions data={lastCompletedTransfer} />}>
              Keep a receipt for your records.
            </Notice>
          )}
        </form>
      }
      summary={
        <>
          <AsideFigure
            label="They receive"
            value={`$${usdc > 0 ? usdc.toFixed(2) : '0.00'}`}
            unit="USDC"
          />
          <div className="mt-5">
            <AsideRows
              rows={[
                { label: 'To', value: email ? <span title={email}>{shortenDetail(email)}</span> : '—' },
                ...(isFiat && usdc > 0 ? [{ label: 'You entered', value: `${symbol}${amount} ${currency}` }] : []),
                { label: 'Network fee', value: 'Covered by us', tone: 'good' as const },
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
            disabled={!smartAddress || isZeroBalance || isOverBalance}
          >
            {isZeroBalance ? 'No balance to send' : isOverBalance ? 'More than your balance' : usdc > 0 ? `Send $${usdc.toFixed(2)}` : 'Send'}
          </FlowButton>
          {status && !(activePlan && activePlan.steps.length > 1) && (
            <p className="text-center text-[13px] leading-[1.5] text-[#cfe0d6] animate-in fade-in duration-300">{status}</p>
          )}
        </>
      }
      extra={extra}
    />
  );
}
