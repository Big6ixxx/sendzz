'use client';

import { format } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  ExternalLink,
  History,
  Landmark,
  MessageSquare,
  Receipt,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Activity } from './HistoryModule';
import { ReceiptActions } from './receipt/ReceiptActions';
import { activityToReceiptData } from '@/lib/receipt/utils';
import { getOffRampRate } from '@/lib/actions/ramp';

const ACTIVITY_LABELS: Record<string, string> = {
  sent: 'Transfer Sent',
  received: 'Funds Received',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  bridge: 'Bridge Transfer',
};

const EXPLORER_BASE_URL = 'https://basescan.org/tx/';

interface ActivityDetailModalProps {
  activity: Activity | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ActivityDetailModal({
  activity,
  isOpen,
  onClose,
}: ActivityDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [estimatedFiatRate, setEstimatedFiatRate] = useState<number | null>(null);

  // For old withdrawal records that predate fiat_amount being saved, fetch the
  // current off-ramp rate so the receipt can show an approximate fiat payout.
  useEffect(() => {
    if (!activity || activity.type !== 'withdrawal' || activity.fiatAmount != null) {
      setEstimatedFiatRate(null);
      return;
    }
    const currency = activity.fiatCurrency || 'NGN';
    getOffRampRate(currency)
      .then(setEstimatedFiatRate)
      .catch(() => setEstimatedFiatRate(null));
  }, [activity?.id]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleEscape);
      // Accessibility: Focus the modal container when it opens
      modalRef.current?.focus();
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !activity) return null;

  const isSuccess =
    activity.status.toLowerCase() === 'settled' ||
    activity.status.toLowerCase() === 'completed' ||
    activity.status.toLowerCase() === 'confirmed' ||
    activity.status.toLowerCase() === 'success';

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center p-4 animate-in fade-in duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Overlay / Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xl"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Content */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="card-glass w-full max-w-sm p-0 overflow-hidden animate-in zoom-in-95 duration-300 relative z-10 shadow-[0_32px_80px_rgba(0,0,0,0.8)] border-white/10 focus:outline-none"
      >
        <div className="p-8 text-center space-y-8">
          {/* Close Button */}
          <button
            onClick={onClose}
            aria-label="Close details"
            className="absolute top-4 right-4 p-2 rounded-full bg-white/5 border border-white/10 text-brand-secondary/40 hover:text-brand-secondary transition-colors outline-none focus:ring-2 focus:ring-accent/50"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex justify-center">
            <div
              className="w-20 h-20 rounded-4xl flex items-center justify-center shadow-2xl relative group"
              style={{
                background: isSuccess
                  ? 'rgba(0, 232, 122, 0.1)'
                  : activity.type === 'sent'
                    ? 'rgba(248, 113, 113, 0.1)'
                    : activity.type === 'received'
                      ? 'rgba(0, 232, 122, 0.1)'
                      : activity.type === 'deposit'
                        ? 'rgba(59, 130, 246, 0.1)'
                        : 'rgba(251, 146, 60, 0.1)',
                color: isSuccess
                  ? '#00e87a'
                  : activity.type === 'sent'
                    ? '#f87171'
                    : activity.type === 'received'
                      ? '#00e87a'
                      : activity.type === 'deposit'
                        ? '#3b82f6'
                        : '#fb923c',
                border: `1px solid ${
                  isSuccess
                    ? 'rgba(0, 232, 122, 0.2)'
                    : activity.type === 'sent'
                      ? 'rgba(248, 113, 113, 0.2)'
                      : activity.type === 'received'
                        ? 'rgba(0, 232, 122, 0.2)'
                        : activity.type === 'deposit'
                          ? 'rgba(59, 130, 246, 0.2)'
                          : 'rgba(251, 146, 60, 0.2)'
                }`,
              }}
            >
              <div className="absolute inset-0 rounded-4xl blur-xl opacity-20 bg-current group-hover:opacity-40 transition-opacity" />
              {activity.type === 'sent' && (
                <ArrowUpRight className="w-10 h-10 relative z-10" />
              )}
              {activity.type === 'received' && (
                <ArrowDownLeft className="w-10 h-10 relative z-10" />
              )}
              {activity.type === 'deposit' && (
                <Wallet className="w-10 h-10 relative z-10" />
              )}
              {activity.type === 'withdrawal' && (
                <Landmark className="w-10 h-10 relative z-10" />
              )}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
              {ACTIVITY_LABELS[activity.type]}
            </p>
            <h3
              id="modal-title"
              className="font-display text-4xl font-bold tracking-tighter text-brand-secondary"
            >
              {activity.amount.toLocaleString()}{' '}
              <span className="text-lg opacity-30 font-bold uppercase">
                {activity.asset}
              </span>
            </h3>
            <div className="flex justify-center mt-3">
              <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-white/4 border border-white/8 text-brand-secondary/60">
                {activity.status}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 text-left">
            {[
              {
                icon: Clock,
                label: 'Timestamp',
                value: format(
                  new Date(activity.timestamp),
                  'MMMM dd, yyyy @ HH:mm',
                ),
              },
              {
                icon: History,
                label: 'Details',
                value: activity.details,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="p-4 rounded-2xl bg-white/2 border border-white/4"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-brand-secondary/20">
                  <item.icon className="w-3 h-3" /> {item.label}
                </p>
                <p className="text-xs font-semibold uppercase truncate text-brand-secondary">
                  {item.value}
                </p>
              </div>
            ))}

            {activity.note && (
              <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-accent">
                  <MessageSquare className="w-3 h-3" /> Memo
                </p>
                <p className="text-sm font-medium leading-relaxed text-brand-secondary/80">
                  {activity.note}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/20 text-center flex items-center justify-center gap-2">
              <Receipt className="w-3 h-3" /> Receipt
            </p>
            <ReceiptActions data={(() => {
              const base = activityToReceiptData(activity);
              // For old withdrawals without saved fiat_amount, fill in an estimate
              // from the current off-ramp rate so the receipt always shows a fiat figure.
              if (activity.type === 'withdrawal' && base.fiatPayoutAmount == null && estimatedFiatRate) {
                return {
                  ...base,
                  fiatPayoutAmount: Math.round(activity.amount * estimatedFiatRate),
                  exchangeRate: estimatedFiatRate,
                };
              }
              return base;
            })()} />
          </div>

          <div className="flex gap-3">
            {activity.txHash && (
              <a
                href={`${EXPLORER_BASE_URL}${activity.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest transition-all bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 outline-none focus:ring-2 focus:ring-accent/50"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Explorer
              </a>
            )}
            <button
              onClick={onClose}
              className="btn-accent flex-1 h-12 rounded-xl text-[10px] font-bold outline-none focus:ring-2 focus:ring-accent/50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
