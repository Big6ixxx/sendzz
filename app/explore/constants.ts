import type { SystemStatus, TimeRange, TxType } from '@/types/public';

export const PAGE_SIZE = 25;

export const TYPE_FILTERS: { label: string; value: TxType | null }[] = [
  { label: 'All', value: null },
  { label: 'Deposits', value: 'deposit' },
  { label: 'Withdrawals', value: 'withdrawal' },
  { label: 'Transfers', value: 'transfer' },
  { label: 'Bridges', value: 'bridge' },
];

export const RANGE_FILTERS: { label: string; value: TimeRange }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
  { label: '6m', value: '6m' },
  { label: '1y', value: '1y' },
  { label: 'All', value: 'all' },
];

export const STATUS_META: Record<
  SystemStatus,
  { label: string; dot: string; text: string; ring: string }
> = {
  operational: {
    label: 'All systems operational',
    dot: 'bg-[#00e87a]',
    text: 'text-[#00e87a]',
    ring: 'border-[#00e87a]/30 bg-[#00e87a]/10',
  },
  degraded: {
    label: 'Degraded performance',
    dot: 'bg-amber-400',
    text: 'text-amber-300',
    ring: 'border-amber-400/30 bg-amber-400/10',
  },
  down: {
    label: 'Service disruption',
    dot: 'bg-red-400',
    text: 'text-red-300',
    ring: 'border-red-400/30 bg-red-400/10',
  },
};
