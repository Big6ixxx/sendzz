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
import { useState } from 'react';
import { CctpDepositForm } from './CctpDepositForm';
import { DepositForm } from './DepositForm';
import { FlowType, useDepositWithdraw } from './useDepositWithdraw';
import { WithdrawForm } from './WithdrawForm';

type DepositTab = 'fiat' | 'usdc';

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

  const hook = useDepositWithdraw(
    type,
    userAddress,
    userEmail,
    userId,
    balance,
    embeddedProvider,
    onClose,
  );

  return (
    <Dialog open={isOpen} onOpenChange={(val) => !val && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md p-0 overflow-hidden border-none rounded-2xl shadow-2xl bg-background"
      >
        <DialogHeader className="p-6 pb-0 flex flex-row items-center justify-between">
          <div className="space-y-1">
            <DialogTitle className="text-3xl font-black uppercase tracking-tighter flex items-center gap-2">
              {type === 'deposit' ? (
                <ArrowDownLeft className="w-8 h-8 p-1.5 bg-foreground text-background rounded-lg" />
              ) : (
                <ArrowUpRight className="w-8 h-8 p-1.5 bg-foreground text-background rounded-lg" />
              )}
              {type === 'deposit' ? 'Deposit Funds' : 'Withdraw Funds'}
            </DialogTitle>
            <DialogDescription className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {type === 'deposit'
                ? 'Deposit funds into your Sendzz wallet'
                : 'Withdraw to Bank Account'}
            </DialogDescription>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </DialogHeader>

        <div className="p-6">
          {type === 'deposit' && (
            <>
              {/* Tab Switcher */}
              <div className="flex bg-muted p-1 rounded-xl mb-6">
                <button
                  onClick={() => setDepositTab('fiat')}
                  className={cn(
                    'flex-1 py-2.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all',
                    depositTab === 'fiat'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Fiat (NGN)
                </button>
                <button
                  onClick={() => setDepositTab('usdc')}
                  className={cn(
                    'flex-1 py-2.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all',
                    depositTab === 'usdc'
                      ? 'bg-background shadow-sm text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  USDC (Bridge)
                </button>
              </div>

              {depositTab === 'fiat' ? (
                <DepositForm hook={hook} />
              ) : (
                <CctpDepositForm userAddress={userAddress} />
              )}
            </>
          )}

          {type === 'withdraw' && <WithdrawForm hook={hook} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
