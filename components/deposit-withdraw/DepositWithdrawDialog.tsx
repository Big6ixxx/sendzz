'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConnectedWallet } from '@privy-io/react-auth';
import { ArrowDownLeft, ArrowUpRight, X } from 'lucide-react';
import { DepositForm } from './DepositForm';
import { FlowType, useDepositWithdraw } from './useDepositWithdraw';
import { WithdrawForm } from './WithdrawForm';

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
                ? 'Convert NGN to USDC'
                : 'Convert USDC to NGN'}
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
          {type === 'deposit' ? (
            <DepositForm hook={hook} />
          ) : (
            <WithdrawForm hook={hook} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
