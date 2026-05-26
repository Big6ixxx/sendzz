'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ConnectedWallet } from '@privy-io/react-auth';
import { ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CctpDepositForm } from './CctpDepositForm';
import { DepositForm } from './DepositForm';
import { SolanaCctpForm } from './SolanaCctpForm';
import { StellarCctpForm } from './StellarCctpForm';
import { FlowType, useDepositWithdraw } from './useDepositWithdraw';
import { WithdrawForm } from './WithdrawForm';

type DepositTab = 'fiat' | 'usdc';
type UsdcChainTab = 'evm' | 'solana' | 'stellar';

interface DepositWithdrawDialogProps {
  isOpen: boolean;
  onClose: () => void;
  type: FlowType;
  userId: string;
  userAddress: string;
  balance: string;
  userEmail: string;
  embeddedProvider?: ConnectedWallet;
}

export function DepositWithdrawDialog({
  isOpen,
  onClose,
  type,
  userId,
  userAddress,
  balance,
  userEmail,
  embeddedProvider,
}: DepositWithdrawDialogProps) {
  const [depositTab, setDepositTab] = useState<DepositTab>('fiat');
  const [usdcChainTab, setUsdcChainTab] = useState<UsdcChainTab>('evm');

  const depositHook = useDepositWithdraw(
    'deposit',
    userAddress,
    userEmail,
    userId,
    balance,
    embeddedProvider,
    onClose,
  );

  const withdrawHook = useDepositWithdraw(
    'withdraw',
    userAddress,
    userEmail,
    userId,
    balance,
    embeddedProvider,
    onClose,
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={(val) => !val && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="sm:max-w-md p-0 overflow-hidden border-none rounded-4xl shadow-[0_32px_80px_rgba(0,0,0,0.5)] card-glass bg-brand-primary/90 backdrop-blur-3xl flex flex-col max-h-[90vh]"
      >
        <DialogHeader className="p-8 pb-0 flex flex-row items-center justify-between">
          <div className="space-y-1.5">
            <DialogTitle className="text-4xl font-display font-bold tracking-tight text-brand-secondary flex items-center gap-3">
              <div
                className={cn(
                  'w-12 h-12 rounded-2xl flex items-center justify-center shrink-0',
                  type === 'deposit'
                    ? 'bg-accent/10 text-accent border border-accent/20'
                    : 'bg-blue-400/10 text-blue-400 border border-blue-400/20',
                )}
              >
                {type === 'deposit' ? (
                  <ArrowDownLeft className="w-6 h-6" />
                ) : (
                  <ArrowUpRight className="w-6 h-6" />
                )}
              </div>
              {type === 'deposit' ? 'Deposit' : 'Withdraw'}
            </DialogTitle>
            <DialogDescription className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
              {type === 'deposit'
                ? 'Fund your digital wallet'
                : 'Withdraw to your bank'}
            </DialogDescription>
          </div>
          <button
            onClick={onClose}
            className="p-3 bg-white/5 border border-white/8 rounded-xl transition-all hover:bg-white/10 group"
          >
            <X className="w-4 h-4 text-brand-secondary/40 group-hover:text-brand-secondary" />
          </button>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0">
          {type === 'deposit' && (
            <div className="px-8 pt-8 pb-4 shrink-0">
              {/* Tab Switcher */}
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
                <button
                  onClick={() => setDepositTab('fiat')}
                  className={cn(
                    'flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all',
                    depositTab === 'fiat'
                      ? 'bg-accent text-[#07070a] shadow-lg'
                      : 'text-brand-secondary/40 hover:text-brand-secondary/60',
                  )}
                >
                  Local Bank
                </button>
                <button
                  onClick={() => setDepositTab('usdc')}
                  className={cn(
                    'flex-1 py-3 text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl transition-all',
                    depositTab === 'usdc'
                      ? 'bg-accent text-[#07070a] shadow-lg'
                      : 'text-brand-secondary/40 hover:text-brand-secondary/60',
                  )}
                >
                  USDC Deposit
                </button>
              </div>
            </div>
          )}

          <div
            className={cn(
              'px-8 pb-8 overflow-y-auto flex-1',
              type === 'withdraw' && 'pt-8',
            )}
          >
            {type === 'deposit' ? (
              depositTab === 'fiat' ? (
                <DepositForm hook={depositHook} />
              ) : (
                <div className="space-y-5">
                  {/* Chain sub-tabs */}
                  <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                    {(['evm', 'solana', 'stellar'] as UsdcChainTab[]).map((chain) => (
                      <button
                        key={chain}
                        onClick={() => setUsdcChainTab(chain)}
                        className={cn(
                          'flex-1 py-2 text-[10px] font-bold uppercase tracking-[0.15em] rounded-lg transition-all',
                          usdcChainTab === chain
                            ? 'bg-white/10 text-brand-secondary shadow'
                            : 'text-brand-secondary/30 hover:text-brand-secondary/50',
                        )}
                      >
                        {chain === 'evm' ? 'EVM' : chain === 'solana' ? 'Solana' : 'Stellar'}
                      </button>
                    ))}
                  </div>

                  {usdcChainTab === 'evm' && (
                    <CctpDepositForm userAddress={userAddress} handleClose={onClose} />
                  )}
                  {usdcChainTab === 'solana' && (
                    <SolanaCctpForm userAddress={userAddress} handleClose={onClose} />
                  )}
                  {usdcChainTab === 'stellar' && (
                    <StellarCctpForm userAddress={userAddress} handleClose={onClose} />
                  )}
                </div>
              )
            ) : (
              <WithdrawForm hook={withdrawHook} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
