'use client';

/**
 * Fees and common questions.
 *
 * Laid out as a price list: what you are doing, and what it costs, with the figure in display
 * type on the right so the eye runs down one column of prices. The platform fee comes from the
 * server (usePlatformFee), never a constant here, so the page cannot disagree with the checkout.
 */

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { DocBody, DocHeader, DocReadNext, DocSection } from '@/components/dashboard/DocLayout';
import { SettingsBack } from '@/components/dashboard/SettingsKit';
import { usePlatformFee } from '@/lib/hooks/usePlatformFee';
import { usePlatformFeePercent } from '@/lib/hooks/usePlatformFeePercent';
import { cn } from '@/lib/utils';

const HELP_FAQS = [
  {
    q: "Is Sendzz non-custodial? What does 'Your Email Is Your Key' mean?",
    a: "Sendzz is 100% non-custodial. Your email address acts as your key to a non-custodial smart wallet. Sendzz never holds your private keys and cannot touch or freeze your funds. You have complete control over your money at all times.",
  },
  {
    q: "How does identity verification (KYC) work, and what are the limits?",
    a: "Sending, receiving and depositing are unlimited and need no verification. The limit applies only to cashing out: an unverified account can withdraw $100 in total to a bank account. After that, a quick 2-minute identity verification removes the limit, keeping Sendzz compliant with financial regulations.",
  },
  {
    q: "Where does Sendzz sponsor gas fees?",
    a: "Sendzz sponsors 100% of network gas fees for P2P transfers and embedded wallet deposits across every supported chain, using account abstraction paymasters. You never need native ETH or SOL to pay for gas.",
  },
  {
    q: "What happens if I send money to an email that isn't registered yet?",
    a: "The funds are held safely in a smart escrow contract. Sendzz emails a secure claim link to the recipient. When they open the link and log in with their email, their smart wallet is created instantly and the funds are claimed automatically.",
  },
  {
    q: "What counts towards my KYC limit?",
    a: "Only fiat withdrawals to your bank account. Sending USDC to an email or wallet address, receiving transfers, crypto deposits, and moving your own funds between networks are all unlimited and never count.",
  },
  {
    q: "How do I contact support?",
    a: "You can reach us at support@sendzz.com. For urgent issues related to stuck transactions or failed withdrawals, please include your email address and transaction ID in your message for faster resolution.",
  },
];

type Price = { what: string; detail: string; price: string; note?: string; good?: boolean };

export default function HelpCenterPage() {
  const platformFee = usePlatformFee();
  const walletSendFee = usePlatformFeePercent('transfer');
  const bridgeFee = usePlatformFeePercent('bridge');
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const groups: { title: string; rows: Price[] }[] = [
    {
      title: 'Sending',
      rows: [
        {
          what: 'To anyone by email',
          detail: 'USDC to another Sendzz account, or to an email that has not joined yet.',
          price: 'Free',
          note: 'Network fee on us',
          good: true,
        },
        {
          what: 'To an outside wallet',
          detail: 'USDC to a wallet address on another app or exchange. Shown before you confirm.',
          price: walletSendFee != null ? `${walletSendFee}%` : '—',
          note: 'Of the amount sent',
        },
      ],
    },
    {
      title: 'Adding money',
      rows: [
        {
          what: 'From your Sendzz wallets',
          detail: 'Moving USDC in from your own Solana or other network wallets.',
          price: 'Free',
          note: 'Network fee on us',
          good: true,
        },
        {
          what: 'From an outside Stellar wallet',
          detail: 'Sending in from a Stellar wallet you hold elsewhere.',
          price: 'Network fee',
          note: 'Paid by the sending wallet',
        },
      ],
    },
    {
      title: 'Cashing out',
      rows: [
        {
          what: 'To your bank or mobile money',
          detail: 'Our fee for paying out locally. Some countries cost a little more than others.',
          price: platformFee != null ? `${platformFee}%` : '—',
          note: 'Of the withdrawal',
        },
        {
          what: 'Network fee',
          detail: 'The cost of processing the payout on the network.',
          price: 'On us',
          note: 'You pay 0 USDC',
          good: true,
        },
      ],
    },
    {
      title: 'Moving between networks',
      rows: [
        {
          what: 'On the Bridge page',
          detail: 'Moving your own money from one network to another. Moves that happen inside a send or a cash out are not charged.',
          price: bridgeFee != null ? `${bridgeFee}%` : '—',
          note: 'Added to the amount moved',
        },
      ],
    },
  ];

  const slug = (t: string) => t.toLowerCase().replace(/[^a-z]+/g, '-');
  const nav = [...groups.map((g) => ({ id: slug(g.title), label: g.title })), { id: 'questions', label: 'Common questions' }];

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 pb-24">
      <SettingsBack />
      <DocHeader
        eyebrow="Help"
        title="What it"
        italic="costs."
        lead="Adding money and sending by email are free. You pay when you cash out to a bank or send to an outside wallet, and we cover network fees almost everywhere."
        meta="Figures come straight from our checkout, so they always match what you are charged."
      />

      <div className="pt-4 lg:pt-12">
        <DocBody items={nav}>
          {groups.map((g, i) => (
            <DocSection key={g.title} id={slug(g.title)} number={i + 1} title={g.title}>
              <ul className="divide-y divide-[#e3dcce] border-t border-[#e3dcce]">
                {g.rows.map((r) => (
                  <li key={r.what} className="flex items-start justify-between gap-6 py-5">
                    <span className="min-w-0">
                      <span className="block text-[17px] font-semibold leading-snug">{r.what}</span>
                      <span className="mt-1 block max-w-[440px] text-[15px] leading-[1.55] text-[var(--lp-body)]">{r.detail}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={cn(
                          'lp-display block text-[clamp(24px,4vw,32px)] leading-none tracking-[-0.03em] tabular-nums',
                          r.good && 'text-[#0e7a45]',
                        )}
                      >
                        {r.price}
                      </span>
                      {r.note && <span className="mt-1.5 block text-[13px] text-[var(--lp-muted)]">{r.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </DocSection>
          ))}

          <DocSection id="questions" number={groups.length + 1} title="Common questions">
            <ul className="divide-y divide-[#e3dcce] border-t border-[#e3dcce]">
              {HELP_FAQS.map((faq, i) => {
                const open = openFaq === i;
                return (
                  <li key={faq.q}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="flex w-full items-center justify-between gap-4 py-4 text-left"
                    >
                      <span className="text-[17px] font-semibold leading-snug">{faq.q}</span>
                      <Plus className={cn('size-5 shrink-0 transition-transform duration-200', open && 'rotate-45')} />
                    </button>
                    {open && (
                      <p className="pb-5 text-[17px] leading-[1.65] text-[var(--lp-body)] animate-in fade-in duration-200">{faq.a}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </DocSection>

          <DocReadNext title="Notifications" body="Choose what reaches your phone and your inbox, kind by kind." href="/dashboard/settings/notifications" />
        </DocBody>
      </div>
    </div>
  );
}
