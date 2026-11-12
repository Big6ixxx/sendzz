import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getUserActivities } from '@/lib/supabase/transactions';
import type { Activity, ActivityType } from '@/components/HistoryModule';

/**
 * Fetches and unifies a user's activity (sent / received / deposits / withdrawals /
 * bridges) into a single `Activity[]`. Shared by the history list and the transaction
 * detail page via the `['history', userEmail]` query key.
 */
export function useActivities(userEmail: string, userId: string) {
  // Stable per user, so React Query filters once per fetch rather than on every render.
  const withoutSelfSends = useCallback(
    (all: Activity[]) =>
      userId ? all.filter((a) => !(a.type === 'received' && a.senderId === userId)) : all,
    [userId],
  );
  return useQuery<Activity[]>({
    queryKey: ['history', userEmail],
    queryFn: async () => {
      const data = await getUserActivities();

      const unified: Activity[] = [
        ...(data.sent || []).map((t) => ({
          id: t.id,
          type: 'sent' as ActivityType,
          amount: t.amount,
          status: t.status,
          timestamp: t.created_at,
          details: `To: ${t.recipient_email}`,
          asset: t.asset,
          txHash: t.tx_hash || (t.note?.startsWith('0x') ? t.note : undefined),
          senderEmail: t.sender_email,
          note: t.note && !t.note.startsWith('0x') ? t.note : undefined,
          expiresAt: t.expires_at ?? undefined,
          sourceChain: t.source_chain ?? undefined,
        })),
        ...(data.received || [])
          .map((t) => ({
            id: t.id,
            type: 'received' as ActivityType,
            senderId: t.sender_id ?? undefined,
            amount: t.amount,
            status: t.status,
            timestamp: t.created_at,
            details: `From: ${t.sender_email}`,
            asset: t.asset,
            txHash: t.tx_hash || (t.note?.startsWith('0x') ? t.note : undefined),
            senderEmail: t.sender_email,
            note: t.note && !t.note.startsWith('0x') ? t.note : undefined,
            sourceChain: t.source_chain ?? undefined,
          })),
        ...(data.deposits || []).map((d) => {
          // On-chain crypto deposits have no fiat leg — label them by network instead of
          // "Via: <fiat> Gateway" (which would render "Via: null Gateway").
          const isOnChain = d.provider === 'onchain' || !d.currency_fiat;
          const meta = (d.provider_metadata ?? null) as { network?: string } | null;
          return {
            id: d.id,
            type: 'deposit' as ActivityType,
            amount: d.amount_usdc || 0,
            status: d.status,
            timestamp: d.created_at,
            details: isOnChain
              ? `Received on ${d.network ?? 'chain'}`
              : `Via: ${d.currency_fiat} Gateway`,
            asset: 'USDC',
            txHash: d.tx_hash || undefined,
            fiatAmount: d.amount_fiat ?? undefined,
            fiatCurrency: d.currency_fiat ?? undefined,
            sourceChain: d.network ?? undefined,
            provider: d.provider ?? undefined,
            providerOrderId: d.provider_order_id ?? undefined,
            settlementNetwork: meta?.network ?? d.network ?? undefined,
            updatedAt: d.updated_at ?? undefined,
          };
        }),
        ...(data.withdrawals || []).map((w) => {
          const meta = (w.provider_metadata ?? null) as { quote_id?: string; network?: string } | null;
          return {
            id: w.id,
            type: 'withdrawal' as ActivityType,
            amount: w.amount_usdc,
            status: w.status,
            timestamp: w.created_at,
            details: `To: ${w.bank_account_masked}`,
            asset: 'USDC',
            txHash: w.tx_hash || undefined,
            fiatAmount: w.fiat_amount ?? undefined,
            fiatCurrency: w.fiat_currency ?? undefined,
            exchangeRate: w.exchange_rate ?? undefined,
            sourceChain: w.source_chain ?? undefined,
            consolidated: w.consolidated ?? undefined,
            provider: w.provider ?? undefined,
            providerOrderId: w.provider_order_id ?? undefined,
            providerRef: meta?.quote_id ?? undefined,
            settlementNetwork: meta?.network ?? w.source_chain ?? undefined,
            updatedAt: w.updated_at ?? undefined,
            // Memo/reference saved at withdrawal creation; surfaces in receipts as "Reference / Memo"
            note: (w as { memo?: string | null }).memo ?? undefined,
          };
        }),
        ...(data.bridges || []).map((b) => {
          const srcName = b.source_chain.charAt(0).toUpperCase() + b.source_chain.slice(1).toLowerCase();
          // Map DB attestation_status to a user-facing status
          const status = b.attestation_status === 'complete'
            ? 'complete'
            : b.attestation_status === 'pending_confirmations'
              ? 'confirming'  // almost ready — waiting on block finality
              : 'pending';
          return {
            id: b.id,
            type: 'bridge' as ActivityType,
            amount: b.amount,
            status,
            timestamp: b.created_at,
            details: `From: ${srcName}`,
            asset: 'USDC',
            txHash: b.burn_tx_hash,
            sourceChain: b.source_chain,
            destChain: b.dest_chain ?? undefined,
            mintTxHash: b.mint_tx_hash || undefined,
          };
        }),
      ];

      return unified;
    },
    // The cache holds the list as the server sent it; each caller drops its own sends to itself
    // here. Filtering inside the fetch baked in whichever caller fetched first, and the detail
    // page can fetch before it knows the user id, leaving self-sends in everyone's list.
    select: withoutSelfSends,
    enabled: !!userEmail,
    refetchInterval: 15000,
    // Shared by the history list, the waiting-for-you panel and the detail page: one load
    // serves all of them for a few seconds instead of each mount loading it again.
    staleTime: 10_000,
  });
}
