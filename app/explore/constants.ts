import type { SystemStatus, TimeRange, TxType } from '@/types/public';

export const PAGE_SIZE = 25;

export const TYPE_FILTERS: { label: string; value: TxType | null }[] = [
  { label: 'All', value: null },
  { label: 'Deposits', value: 'deposit' },
  { label: 'Withdrawals', value: 'withdrawal' },
  { label: 'Transfers', value: 'transfer' },
  { label: 'Moves', value: 'bridge' },
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
    dot: 'bg-[#04c96a]',
    text: 'text-[#0b5e36]',
    ring: 'bg-[#cdf5de]',
  },
  degraded: {
    label: 'Degraded performance',
    dot: 'bg-[#e0a526]',
    text: 'text-[#6b4600]',
    ring: 'bg-[#fbedcc]',
  },
  down: {
    label: 'Service disruption',
    dot: 'bg-[#a1462c]',
    text: 'text-[#8a3a24]',
    ring: 'bg-[#fbe7df]',
  },
};
