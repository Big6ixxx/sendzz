'use client';

import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { ArrowLeft, Zap, Coins, Landmark, ArrowRightLeft, ShieldCheck, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function FeesHelpPage() {
  const router = useRouter();

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Settings
        </button>
        <DashboardPageHeader
          title="Fee Schedule & Gas"
          subtitle="Complete transparency on platform fees, network costs, and where Sendzz sponsors your transactions."
        />
      </div>

      <div className="space-y-8">
        {/* Withdrawals */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
            <Landmark className="w-4 h-4 text-accent" />
            Fiat Withdrawals (Off-Ramp)
          </h3>
          <div className="card-glass p-6 space-y-4 relative overflow-hidden group hover:border-accent/30 transition-colors">
            <div className="absolute right-0 top-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-accent/10 transition-colors" />
            
            <div className="flex justify-between items-start border-b border-white/5 pb-4">
              <div>
                <p className="font-bold text-foreground">Platform Fee</p>
                <p className="text-[11px] text-muted-foreground max-w-[250px] mt-1">
                  Charged by our fiat payout partners to process the transfer to your local bank account.
                </p>
              </div>
              <div className="text-right">
                <p className="font-black text-xl text-accent">0.3%</p>
                <p className="text-[10px] uppercase font-bold text-muted-foreground">Of withdrawal amount</p>
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

        {/* Smart Transfers */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-blue-400" />
            Sendzz P2P Transfers
          </h3>
          <div className="card-glass p-6 space-y-4 relative overflow-hidden group hover:border-blue-400/30 transition-colors">
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
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-2">
            <Coins className="w-4 h-4 text-purple-400" />
            Deposits & Cross-Chain Bridging
          </h3>
          <div className="card-glass p-0 overflow-hidden divide-y divide-white/5">
            
            <div className="p-6 hover:bg-white/2 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-foreground">Embedded Solana Wallet Deposit</p>
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

            <div className="p-6 hover:bg-white/2 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-foreground">Embedded EVM Wallets (Optimism, Polygon, etc.)</p>
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

            <div className="p-6 hover:bg-white/2 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-foreground">External Stellar Wallet Deposit</p>
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

            <div className="p-6 hover:bg-white/2 transition-colors bg-black/20">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-bold text-foreground">Circle CCTP Bridge Fee</p>
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
  );
}
