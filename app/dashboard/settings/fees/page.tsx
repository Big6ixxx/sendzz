'use client';

import {
  ArrowLeft,
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  Coins,
  HelpCircle,
  Key,
  Landmark,
  MessageCircleQuestion,
  Receipt,
  Send,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { PLATFORM_FEE_PERCENT } from '@/lib/ramp/fees';

// ─── Data ────────────────────────────────────────────────────────────────────

const HELP_FAQS = [
  {
    q: "Is Sendzz non-custodial? What does 'Your Email Is Your Key' mean?",
    a: "Sendzz is 100% non-custodial. Your email address acts as your key via Privy's non-custodial Smart Wallet infrastructure (ERC-4337 on Base). Sendzz never holds your private keys and cannot touch or freeze your funds. You have complete control over your money at all times.",
    icon: Key,
    badge: "Non-Custodial",
  },
  {
    q: "How does identity verification (KYC) work, and what are the limits?",
    a: "To ensure compliance with financial regulations, unverified accounts have a transaction limit of $500 per rolling 24-hour period ($2,500 weekly, $10,000 monthly). Once you reach $500 in cumulative outgoing volume, you'll be prompted to complete a quick 2-minute identity verification powered by Didit to unlock unlimited transactions.",
    icon: ShieldCheck,
    badge: "$500 Daily Limit",
  },
  {
    q: "Where does Sendzz sponsor gas fees?",
    a: "Sendzz sponsors 100% of network gas fees for P2P transfers and embedded wallet deposits on Base, Solana, and EVM chains using Circle Gas Station and Account Abstraction paymasters. You never need native ETH or SOL to pay for gas.",
    icon: Zap,
    badge: "Free Gas",
  },
  {
    q: "What happens if I send money to an email that isn't registered yet?",
    a: "The funds are held safely in a smart escrow contract. Sendzz emails a secure claim link to the recipient. When they open the link and log in with their email, their smart wallet is created instantly and the funds are claimed automatically.",
    icon: Send,
    badge: "Universal Escrow",
  },
  {
    q: "What counts towards my KYC transaction limit?",
    a: "Outgoing transfers (sending USDC to any email or wallet address) and fiat off-ramps (selling USDC to your bank) count towards your limit. Receiving transfers, crypto deposits, and cross-chain bridging of your own funds between networks do NOT count.",
    icon: Receipt,
    badge: "Limit Scope",
  },
  {
    q: "How do I contact support?",
    a: "You can reach us at support@sendzz.com. For urgent issues related to stuck transactions or failed withdrawals, please include your email address and transaction ID in your message for faster resolution.",
    icon: MessageCircleQuestion,
    badge: "Support",
  },
];

// ─── FaqItem ─────────────────────────────────────────────────────────────────

function HelpFaqItem({ faq }: { faq: (typeof HELP_FAQS)[number] }) {
  const [open, setOpen] = useState(false);
  const Icon = faq.icon;

  return (
    <div className="card-glass p-0 overflow-hidden border border-white/5 hover:border-white/10 transition-colors">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-5 text-left flex items-center justify-between gap-4 hover:bg-white/2 transition-colors"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-accent/10 text-accent">
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground">{faq.q}</p>
            <span className="text-[9px] font-bold uppercase tracking-widest text-accent">
              {faq.badge}
            </span>
          </div>
        </div>
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center border border-white/10 shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180 bg-white/10' : 'bg-white/5'
          }`}
        >
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-white/5 bg-white/[0.01]">
          <p className="text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HelpCenterPage() {
  const router = useRouter();

  return (
    <div className="max-w-5xl mx-auto space-y-10">

      {/* Back nav */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3 h-3" />
        Back to Settings
      </button>

      {/* Page header — Help Center style, not fee-specific */}
      <div className="relative card-glass p-8 overflow-hidden border border-white/8">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent pointer-events-none" />
        <div className="absolute -right-16 -top-16 w-56 h-56 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex items-start gap-5">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
            <BookOpen className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-foreground tracking-tight">Help Center</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl leading-relaxed">
              Everything you need to know about fees, gas sponsorship, identity limits, and how Sendzz works.
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {[
                { label: 'Fees & Gas', icon: Zap },
                { label: 'KYC & Limits', icon: ShieldCheck },
                { label: 'Transfers', icon: ArrowRightLeft },
                { label: 'FAQ', icon: HelpCircle },
              ].map(({ label, icon: I }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/5 border border-white/8 text-muted-foreground"
                >
                  <I className="w-3 h-3" /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section: Fees & Gas ───────────────────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-accent/10 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h2 className="text-sm font-black text-foreground uppercase tracking-wider">Fee Schedule & Gas</h2>
            <p className="text-[10px] text-muted-foreground">Full transparency on what you pay and what we cover</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Fiat Withdrawals */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
              <Landmark className="w-3.5 h-3.5 text-accent" />
              Fiat Withdrawals (Off-Ramp)
            </h3>
            <div className="card-glass p-6 space-y-4 relative overflow-hidden group hover:border-accent/30 transition-colors">
              <div className="absolute right-0 top-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-accent/10 transition-colors" />

              <div className="flex justify-between items-start border-b border-white/5 pb-4">
                <div>
                  <p className="font-bold text-foreground">Platform Fee</p>
                  <p className="text-[11px] text-muted-foreground max-w-[260px] mt-1">
                    Our fee for moving money between your wallet and your local bank account. The same rate applies to deposits and withdrawals.
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-black text-xl text-accent">{PLATFORM_FEE_PERCENT}%</p>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground">Of deposit or withdrawal</p>
                </div>
              </div>

              <div className="flex justify-between items-start pt-2">
                <div>
                  <p className="font-bold text-foreground">Network Gas Fee (Base)</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    The cost to process the smart contract transaction on the Base network.
                  </p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="flex items-center gap-1.5 text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                    <Zap className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Sponsored</span>
                  </div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1.5">You pay 0 USDC</p>
                </div>
              </div>
            </div>
          </div>

          {/* P2P Transfers */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
              <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400" />
              Sendzz P2P Transfers
            </h3>
            <div className="card-glass p-6 relative overflow-hidden group hover:border-blue-400/30 transition-colors">
              <div className="absolute right-0 top-0 w-32 h-32 bg-blue-400/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-blue-400/10 transition-colors" />
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-foreground">Smart Account Transfers</p>
                  <p className="text-[11px] text-muted-foreground max-w-[300px] mt-1">
                    Sending USDC between Sendzz users on the Base network using your Smart Account.
                  </p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="flex items-center gap-1.5 text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">100% Free</span>
                  </div>
                  <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1.5">Gas is Sponsored</p>
                </div>
              </div>
            </div>
          </div>

          {/* Deposits & Bridging */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-purple-400" />
              Deposits & Cross-Chain Bridging
            </h3>
            <div className="card-glass p-0 overflow-hidden divide-y divide-white/5">

              <div className="p-5 hover:bg-white/2 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-foreground text-sm">Embedded Solana Wallet Deposit</p>
                    <p className="text-[11px] text-muted-foreground max-w-[300px] mt-1">
                      Depositing USDC from your Sendzz Embedded Solana Wallet to Base.
                    </p>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-center gap-1.5 text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                      <Zap className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Sponsored</span>
                    </div>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1.5">Via Circle Gas Station</p>
                  </div>
                </div>
              </div>

              <div className="p-5 hover:bg-white/2 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-foreground text-sm">Embedded EVM Wallets (Optimism, Polygon, etc.)</p>
                    <p className="text-[11px] text-muted-foreground max-w-[300px] mt-1">
                      Depositing USDC from your Sendzz Embedded EVM Wallet to Base.
                    </p>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-center gap-1.5 text-green-400 bg-green-400/10 px-2 py-1 rounded-md">
                      <Zap className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Sponsored</span>
                    </div>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1.5">Via Circle Gas Station / Paymaster</p>
                  </div>
                </div>
              </div>

              <div className="p-5 hover:bg-white/2 transition-colors">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-foreground text-sm">External Stellar Wallet Deposit</p>
                    <p className="text-[11px] text-muted-foreground max-w-[300px] mt-1">
                      Depositing from Stellar networks.
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center w-fit justify-self-end gap-1.5 text-brand-secondary bg-brand-secondary/10 px-2 py-1 rounded-md mb-1.5 justify-end">
                      <Wallet className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-black uppercase tracking-widest">User Pays</span>
                    </div>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1 text-right">Native Gas Token Required</p>
                  </div>
                </div>
              </div>

              <div className="p-5 hover:bg-white/2 transition-colors bg-black/20">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-bold text-foreground text-sm">Circle CCTP Bridge Fee</p>
                    <p className="text-[11px] text-muted-foreground max-w-[300px] mt-1">
                      A small dynamic protocol fee charged by Circle when bridging USDC across chains.
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-sm text-foreground">Dynamic</p>
                    <p className="text-[10px] uppercase font-bold text-muted-foreground mt-1">Deducted from USDC</p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-white/5" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">FAQ</span>
        <div className="flex-1 h-px bg-white/5" />
      </div>

      {/* ── Section: FAQ ──────────────────────────────────────────────────── */}
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-white/5 flex items-center justify-center">
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-black text-foreground uppercase tracking-wider">Frequently Asked Questions</h2>
            <p className="text-[10px] text-muted-foreground">Common questions about security, limits, and how Sendzz works</p>
          </div>
        </div>

        <div className="space-y-3">
          {HELP_FAQS.map((faq, idx) => (
            <HelpFaqItem key={idx} faq={faq} />
          ))}
        </div>
      </div>

    </div>
  );
}
