'use client';

import { use, useEffect, useState, useMemo } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ArrowLeft, Check, ChevronDown, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { EASE } from '@/components/landing/motion';
import { ACTIVITY_LOOK, activityStatus, detailHasIdentifier, shortenDetail } from '@/components/dashboard/activity-look';
import { toast } from 'sonner';
import { useActivities } from '@/hooks/useActivities';
import { useQueryClient } from '@tanstack/react-query';
import { CHAIN_META } from '@/components/deposit-withdraw/deposit-shared';
import { explorerTxUrl, HOME_CHAIN, isPlaceholderHash } from '@/lib/explorers';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { activityToReceiptData } from '@/lib/receipt/utils';
import { getOffRampRate } from '@/lib/actions/ramp';
import { executeReceiveMessage } from '@/lib/web3/bridge-actions';
import { claimBridgeOnDestination } from '@/lib/web3/bridge-claim';
import { privySolanaAddress } from '@/lib/solana/privy-address';
import type { ActivityType } from '@/components/HistoryModule';
import { CCTP_DOMAINS, type SupportedChain } from '@/lib/circle/gateway';
import { publicOrderId } from '@/lib/ramp/public-order-id';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

/** Middle-truncate long values (hashes / ids) for display; the full value is still copied. */
function shorten(v: string, head = 10, tail = 8): string {
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

/** One label/value line: the value can be copied whole and, for a transaction, opened in an explorer. */
function DetailRow({
  label,
  value,
  display,
  copyable,
  href,
  note,
  mono,
}: {
  label: string;
  value: string;
  display?: string;
  copyable?: boolean;
  href?: string;
  /** Prose rather than an identifier: wraps under the label instead of sitting beside it. */
  note?: boolean;
  /** An id or hash, set in the mono face. */
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(`${label} copied`);
    setTimeout(() => setCopied(false), 1500);
  };
  const icon = 'grid size-8 shrink-0 place-items-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-cream)] hover:text-[var(--lp-ink)]';
  return (
    <div className={note ? 'space-y-1 py-3.5' : 'flex min-w-0 items-center justify-between gap-4 py-3'}>
      <span className="shrink-0 text-[14px] text-[var(--lp-muted)]">{label}</span>
      <span className={note ? 'block text-[14px] leading-[1.5] text-[var(--lp-body)]' : 'flex min-w-0 items-center gap-1'}>
        <span
          className={
            note
              ? undefined
              : `min-w-0 truncate text-right text-[15px] font-semibold ${mono ? 'lp-mono text-[13.5px] font-normal' : ''}`
          }
          title={note ? undefined : value}
        >
          {display ?? value}
        </span>
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className={icon} aria-label={`Open ${label} in explorer`}>
            <ExternalLink className="size-4" />
          </a>
        )}
        {copyable && (
          <button type="button" onClick={copy} className={icon} aria-label={`Copy ${label}`}>
            {copied ? <Check className="size-4 text-[#0e7a45]" /> : <Copy className="size-4" />}
          </button>
        )}
      </span>
    </div>
  );
}

export default function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const isPromise =
    params && typeof (params as Promise<{ id: string }>).then === 'function';
  const { id } = isPromise ? use(params as Promise<{ id: string }>) : (params as { id: string });

  const { user } = usePrivy();
  const { wallets } = useWallets();
  const userEmail = user?.email?.address || '';
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data: activities, isLoading, refetch } = useActivities(userEmail, user?.id || '');

  const [notificationDetail, setNotificationDetail] = useState<{
    id: string;
    title: string;
    body: string;
    type: string;
    created_at: string;
    data?: Record<string, unknown> | null;
  } | null>(null);

  useEffect(() => {
    if (!userEmail || !id) return;
    let active = true;
    fetch(`/api/notifications?email=${encodeURIComponent(userEmail)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        interface NotificationItem {
          id: string;
          title: string;
          body: string;
          type: string;
          created_at: string;
          data?: Record<string, unknown> | null;
        }
        const notifs = (data.notifications || []) as NotificationItem[];
        const found = notifs.find((n) => n.id === id);
        if (found) {
          setNotificationDetail(found);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [userEmail, id]);

  const activity = useMemo(() => {
    if (!id) return null;
    const lower = id.toLowerCase();

    // 1. Try to find direct match in user activities by id, orderId, or txHash
    let direct = activities?.find(
      (a) =>
        a.id === id ||
        a.id.toLowerCase() === lower ||
        a.providerOrderId === id ||
        (a.txHash && a.txHash.toLowerCase() === lower)
    );
    if (direct) return direct;

    // 2. If notificationDetail has a target transactionId, search activities with that
    const targetTxId = (notificationDetail?.data?.transactionId ||
      notificationDetail?.data?.id ||
      notificationDetail?.data?.txId ||
      notificationDetail?.data?.referenceId) as string | undefined;

    if (targetTxId && activities) {
      const targetLower = targetTxId.toLowerCase();
      direct = activities.find(
        (a) =>
          a.id === targetTxId ||
          a.id.toLowerCase() === targetLower ||
          a.providerOrderId === targetTxId ||
          (a.txHash && a.txHash.toLowerCase() === targetLower)
      );
      if (direct) return direct;
    }

    // 3. Smart Fallback Match: Find matching transaction in activities table by amount, type & timestamp
    if (notificationDetail && activities && activities.length > 0) {
      const notifData = notificationDetail.data || {};
      const notifAmount = Number(notifData.amount || 0);
      const notifType = notificationDetail.type; // 'bridge', 'withdrawal', 'deposit', 'transfer'
      const notifTime = new Date(notificationDetail.created_at).getTime();

      const dbMatch = activities.find((a) => {
        const typeMatch =
          (notifType === 'bridge' && a.type === 'bridge') ||
          (notifType === 'withdrawal' && a.type === 'withdrawal') ||
          (notifType === 'deposit' && a.type === 'deposit') ||
          (notifType === 'transfer' && (a.type === 'sent' || a.type === 'received'));

        if (!typeMatch) return false;

        // Compare amounts if present in notification data
        if (notifAmount > 0 && Math.abs(a.amount - notifAmount) > 0.01) {
          return false;
        }

        // Compare source chain if available
        if (notifData.src && a.sourceChain && a.sourceChain.toLowerCase() !== (notifData.src as string).toLowerCase()) {
          return false;
        }

        // Match within 15 minutes of creation timestamp
        const aTime = new Date(a.timestamp).getTime();
        return Math.abs(aTime - notifTime) < 15 * 60 * 1000;
      });

      if (dbMatch) return dbMatch;
    }

    // 4. Fallback for non-transaction notifications: format details & status cleanly matching real activity format
    if (notificationDetail) {
      const d = notificationDetail.data || {};
      const typeStr = notificationDetail.type as string;
      const isSecurity = typeStr === 'security';
      const type: ActivityType =
        isSecurity ? 'security' :
        typeStr === 'withdrawal' ? 'withdrawal' :
        typeStr === 'deposit' ? 'deposit' :
        typeStr === 'bridge' ? 'bridge' :
        typeStr === 'transfer' ? 'sent' : 'received';

      const amount = Number(d.amount || 0);
      const fiatAmount = d.fiatAmount ? Number(d.fiatAmount) : undefined;
      const fiatCurrency = (d.fiatCurrency || 'NGN') as string;

      let details = notificationDetail.body;
      if (type === 'bridge' && (d.src || d.sourceChain)) {
        const srcChain = (d.src || d.sourceChain) as string;
        const srcName = CHAIN_META[srcChain.toLowerCase()]?.name ?? (srcChain.charAt(0).toUpperCase() + srcChain.slice(1).toLowerCase());
        details = `From: ${srcName}`;
      } else if (type === 'withdrawal' && d.bankMasked) {
        details = `To: ${d.bankMasked}`;
      } else if (type === 'sent' || type === 'received') {
        details = d.sender ? `From: ${d.sender}` : d.recipient ? `To: ${d.recipient}` : details;
      }

      return {
        id: (d.transactionId || d.referenceId || d.id || notificationDetail.id) as string,
        type,
        amount,
        status: 'complete',
        timestamp: notificationDetail.created_at,
        details,
        note: notificationDetail.title,
        asset: 'USDC',
        txHash: (d.txHash || d.burnTxHash) as string | undefined,
        mintTxHash: d.mintTxHash as string | undefined,
        fiatAmount,
        fiatCurrency,
        sourceChain: (d.src || d.sourceChain) as string | undefined,
        destChain: (d.dest || d.destChain) as string | undefined,
        providerOrderId: (d.providerOrderId || d.orderId) as string | undefined,
      };
    }

    return null;
  }, [activities, id, notificationDetail]);

  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [estimatedFiatRate, setEstimatedFiatRate] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Estimate a fiat payout for legacy withdrawals that predate fiat_amount being stored.
  const aType = activity?.type;
  const aFiatAmount = activity?.fiatAmount;
  const aFiatCurrency = activity?.fiatCurrency;
  useEffect(() => {
    if (aType !== 'withdrawal' || aFiatAmount != null) return;
    let active = true;
    getOffRampRate(aFiatCurrency || 'NGN')
      .then((rate) => active && setEstimatedFiatRate(rate))
      .catch(() => active && setEstimatedFiatRate(null));
    return () => {
      active = false;
    };
  }, [aType, aFiatAmount, aFiatCurrency]);

  const handleClaim = async () => {
    if (!activity?.txHash) return;
    setIsClaiming(true);
    try {
      const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
      if (!embeddedWallet) {
        toast.error("Your wallet isn't ready yet. Please sign in again.");
        return;
      }
      const sourceChain = activity.sourceChain?.toLowerCase();
      const destChain = activity.destChain?.toLowerCase() as SupportedChain;

      let domain: number | null = null;
      if (sourceChain === 'solana') domain = 5;
      else if (sourceChain === 'stellar') domain = 27;
      else if (sourceChain && sourceChain in CCTP_DOMAINS) {
        domain = CCTP_DOMAINS[sourceChain as keyof typeof CCTP_DOMAINS];
      }
      if (domain === null) {
        toast.error("We couldn't tell which network this came from.");
        setIsClaiming(false);
        return;
      }

      // ── Fast path: already minted ────────────────────────────────────────
      if (activity.mintTxHash) {
        toast.info('This already arrived. Refreshing…');
        await fetch('/api/bridge/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ burnTxHash: activity.txHash, mintTxHash: activity.mintTxHash }),
        }).catch(() => {});
        setClaimSuccess(true);
        queryClient.invalidateQueries({ queryKey: ['history'] });
        refetch();
        return;
      }

      // ── Fetch attestation (DB-cached by status route) ────────────────────
      toast.info('Checking on your transfer…');
      const res = await fetch(
        `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${sourceChain}`,
      );
      if (!res.ok) throw new Error(`Status API error: ${res.statusText}`);
      const data = await res.json();

      if (!data || data.status === 'not_found') {
        toast.error("We couldn't find this transfer on the network yet. Check back shortly.");
        setIsClaiming(false);
        return;
      }
      if (data.status === 'pending' || data.status === 'pending_confirmations') {
        const chainDisplay = sourceChain
          ? sourceChain.charAt(0).toUpperCase() + sourceChain.slice(1)
          : 'source chain';
        const isPendingConf = data.status === 'pending_confirmations';
        const wait = isPendingConf ? '1–2 minutes' : '2–5 minutes';
        const detail = isPendingConf
          ? 'Almost there, the network is nearly done confirming.'
          : 'Waiting for block confirmations on the source chain.';
        toast.error(`${chainDisplay} bridge is still being verified. ${detail} Try again in ${wait}.`, { duration: 8000 });
        setIsClaiming(false);
        return;
      }
      if (data.status !== 'complete') {
        toast.error('Still on its way. Try again in a moment.');
        setIsClaiming(false);
        return;
      }

      let mintTxHash = data.mintTxHash || null;

      const isEvmDest = destChain && destChain in CCTP_DOMAINS;
      if (isEvmDest) {
        if (!mintTxHash) {
          if (!data.messageBytes || !data.attestation) {
            throw new Error('Attestation data incomplete. Please try again in 30 seconds.');
          }
          // Check if Circle's relayer already minted before trying manually
          toast.info('Delivering your money…');
          await new Promise(r => setTimeout(r, 3000));
          const recheckRes = await fetch(
            `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${sourceChain}`,
          );
          const recheckData = await recheckRes.json().catch(() => ({}));
          if (recheckData.mintTxHash) {
            mintTxHash = recheckData.mintTxHash;
          } else {
            // Relayer hasn't minted — submit receiveMessage ourselves
            mintTxHash = await executeReceiveMessage(
              embeddedWallet,
              data.messageBytes,
              data.attestation,
              destChain
            );
          }
        }
      } else if ((destChain as string) === 'stellar') {
        if (!mintTxHash) {
          toast.info('Delivering your money on Stellar. We cover the network fee.');
          const claimRes = await fetch('/api/stellar/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txHash: activity.txHash, sourceChain }),
          });
          if (!claimRes.ok) {
            const claimErr = await claimRes.json();
            throw new Error(claimErr.error || 'Failed to claim on Stellar');
          }
          mintTxHash = (await claimRes.json()).txHash;
        }
      } else if ((destChain as string) === 'solana') {
        if (!mintTxHash) {
          toast.info('Delivering your money on Solana…');
          // Only the address is needed — the server signs — so read it from Privy rather than
          // waiting on the Solana wallets hook.
          const solAddress = privySolanaAddress(user);
          if (!solAddress) throw new Error('Solana wallet not found.');
          mintTxHash = await claimBridgeOnDestination({
            destChain: 'solana',
            sourceChain,
            burnTxHash: activity.txHash,
            messageBytes: data.messageBytes,
            attestation: data.attestation,
            solanaWallet: { address: solAddress },
          });
        }
      }

      await fetch('/api/bridge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ burnTxHash: activity.txHash, mintTxHash }),
      }).catch(() => {});

      toast.success('All done. Your money has arrived.');
      setClaimSuccess(true);
      // Wait briefly then invalidate so the Mint Tx link replaces the pill
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['history'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        refetch();
      }, 1500);
    } catch (err: unknown) {
      const rawErrMsg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      const alreadyProcessed =
        rawErrMsg.includes('nonce already used') ||
        rawErrMsg.includes('message already received') ||
        rawErrMsg.includes('message already processed');

      if (alreadyProcessed) {
        // Circle's relayer already minted — re-poll Iris to get the forwardTxHash
        toast.info('This already arrived. Updating your history…');
        try {
          const retryRes = await fetch(
            `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${activity.sourceChain?.toLowerCase()}`,
          );
          const retryData = await retryRes.json().catch(() => ({}));
          const relayedHash = retryData.mintTxHash || null;
          await fetch('/api/bridge/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ burnTxHash: activity.txHash, mintTxHash: relayedHash }),
          }).catch(() => {});
        } catch {
          await fetch('/api/bridge/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ burnTxHash: activity.txHash }),
          }).catch(() => {});
        }
        setClaimSuccess(true);
        queryClient.invalidateQueries({ queryKey: ['history'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        refetch();
      } else {
        const rawMsg = err instanceof Error ? err.message : String(err);
        console.error('[Manual Claim Page] Raw error:', rawMsg);
        // Strip hex blobs for display but always show something useful
        const displayMsg = rawMsg.replace(/0x[0-9a-fA-F]{20,}/g, '[hex]').slice(0, 200);
        toast.error(displayMsg || 'Claim failed. Please try again.');
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // ── Loading / not found ──────────────────────────────────────────────────────
  // Back to wherever the person came from: History, Notifications, the overview, Transfer.
  // Opened cold (a pasted link, a new tab) there is nothing to go back to, so History stands in.
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push('/dashboard/history');
  };
  const backLink = (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex h-10 items-center gap-2 rounded-full bg-white pl-3 pr-4 text-[14px] font-semibold shadow-[0_0_0_1px_rgb(17_26_19/0.08)] transition-shadow hover:shadow-[0_0_0_1px_rgb(17_26_19/0.3)]"
    >
      <ArrowLeft className="size-4" /> Back
    </button>
  );

  if (isLoading && !activity) {
    return <PageSkeleton variant="detail" />;
  }

  if (!activity) {
    return (
      <div className="mx-auto flex max-w-[480px] flex-col items-center gap-4 py-20 text-center">
        <p className="lp-display text-[28px] font-semibold tracking-[-0.02em]">
          We can&apos;t find <span className="lp-serif">that one.</span>
        </p>
        <p className="text-[15px] leading-[1.5] text-[var(--lp-muted)]">
          It may still be on its way, or the link may be out of date. Everything you&apos;ve sent and received is in your
          history.
        </p>
        {backLink}
      </div>
    );
  }

  const look = ACTIVITY_LOOK[activity.type as ActivityType] ?? ACTIVITY_LOOK.security;
  const status = activityStatus(activity.status) ?? { text: 'Completed', tone: 'bg-[var(--lp-green)] text-[var(--lp-ink)]' };
  const isOutgoing = activity.type === 'sent' || activity.type === 'withdrawal';

  // Network(s): accurate for bridges; transfers don't persist their chain yet.
  // Transfers don't persist their chain yet, so an unknown chain means the home chain.
  const burnExplorer = explorerTxUrl(
    activity.sourceChain ?? HOME_CHAIN,
    activity.txHash,
  );

  const receiptData = (() => {
    const base = activityToReceiptData(activity);
    if (activity.type === 'withdrawal' && base.fiatPayoutAmount == null && estimatedFiatRate) {
      return {
        ...base,
        fiatPayoutAmount: Math.round(activity.amount * estimatedFiatRate),
        exchangeRate: estimatedFiatRate,
      };
    }
    return base;
  })();

  const chainLabel = (chain: string) => CHAIN_META[chain.toLowerCase()]?.name ?? chain;
  const counterparty = activity.details.replace(/^(To|From):\s*/, '');

  type Row = { label: string; value: string; display?: string; copyable?: boolean; href?: string; note?: boolean; mono?: boolean };
  const detailRows: Row[] = [
    { label: 'Date', value: format(new Date(activity.timestamp), 'd MMMM yyyy, HH:mm') },
  ];
  if (activity.type === 'security') {
    detailRows.push({ label: 'Details', value: activity.details, note: true });
  } else if (activity.type !== 'bridge') {
    // A move's route row already says where it came from.
    detailRows.push({
      label: isOutgoing ? 'To' : 'From',
      value: counterparty,
      display: shortenDetail(counterparty),
      copyable: detailHasIdentifier(counterparty),
    });
  }
  if (activity.type === 'bridge' && activity.sourceChain) {
    detailRows.push({ label: 'Route', value: `${chainLabel(activity.sourceChain)} → ${chainLabel(activity.destChain ?? 'base')}` });
  } else if (activity.sourceChain) {
    detailRows.push({ label: 'Network', value: chainLabel(activity.sourceChain) });
  }

  // ── Advanced details: provider refs, full hashes, rate, timestamps ───────────
  const hasValidMint = !!activity.mintTxHash && !isPlaceholderHash(activity.mintTxHash);
  const mintExplorer = explorerTxUrl(
    activity.destChain ?? HOME_CHAIN,
    activity.mintTxHash,
  );

  const advancedRows: Row[] = [];

  // Which payout provider settled it stays ours to know; only an on-chain settlement is named.
  if (activity.provider === 'onchain') {
    advancedRows.push({ label: 'Settled via', value: 'On-chain' });
  }
  if (activity.providerOrderId) {
    const orderId = publicOrderId(activity.providerOrderId);
    advancedRows.push({ label: 'Order ID', value: orderId, display: shorten(orderId), copyable: true, mono: true });
  }
  if (activity.providerRef) {
    advancedRows.push({ label: 'Payout quote', value: activity.providerRef, display: shorten(activity.providerRef), copyable: true, mono: true });
  }
  if (activity.settlementNetwork) {
    advancedRows.push({ label: 'Settlement network', value: chainLabel(activity.settlementNetwork) });
  }
  const rate = activity.exchangeRate ?? estimatedFiatRate;
  if (rate && activity.fiatCurrency) {
    advancedRows.push({
      label: 'Exchange rate',
      value: `1 USDC ≈ ${rate.toLocaleString()} ${activity.fiatCurrency}${activity.exchangeRate == null ? ' (est.)' : ''}`,
    });
  }
  advancedRows.push({ label: 'Reference', value: activity.id, display: shorten(activity.id, 12, 6), copyable: true, mono: true });
  if (activity.txHash) {
    advancedRows.push({
      label: activity.type === 'bridge' ? 'Burn tx' : 'Transaction',
      value: activity.txHash,
      display: shorten(activity.txHash),
      copyable: true,
      href: burnExplorer ?? undefined,
      mono: true,
    });
  }
  if (hasValidMint) {
    advancedRows.push({ label: 'Mint tx', value: activity.mintTxHash!, display: shorten(activity.mintTxHash!), copyable: true, href: mintExplorer ?? undefined, mono: true });
  } else if (activity.type === 'bridge' && activity.status === 'complete') {
    // Delivery was confirmed by reading the destination chain, not by watching our own claim
    // land, so there is no transaction id to show. Say that plainly rather than inventing a
    // hash or leaving the row out — a bridge with a burn tx and no mint tx reads as unfinished.
    advancedRows.push({
      label: 'Mint tx',
      value: 'Confirmed on the destination chain. The transaction id was not recorded.',
      note: true,
    });
  }
  advancedRows.push({
    label: 'Created',
    value: format(new Date(activity.timestamp), 'd MMM yyyy, HH:mm:ss'),
  });
  if (activity.updatedAt && activity.updatedAt !== activity.timestamp) {
    advancedRows.push({
      label: 'Updated',
      value: format(new Date(activity.updatedAt), 'd MMM yyyy, HH:mm:ss'),
    });
  }

  // The bridge's second leg: a link once it landed, otherwise a way to finish it.
  const bridgeAction =
    activity.type !== 'bridge'
      ? null
      : hasValidMint
        ? 'mint'
        : activity.status === 'complete'
          ? null
          : claimSuccess
            ? 'claimed'
            : Date.now() - new Date(activity.timestamp).getTime() < 10 * 60 * 1000
              ? 'recent'
              : 'claim';

  const card = 'lp-card rounded-[28px] px-5 py-2 sm:px-6';
  const pill =
    'inline-flex h-12 w-full items-center sm:flex-1 justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold transition-colors disabled:opacity-60';
  const Icon = look.icon;

  return (
    <div className="mx-auto max-w-[1040px] space-y-6 pb-24">
      {backLink}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        {/* ── Summary ───────────────────────────────────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative overflow-hidden rounded-[32px] bg-[var(--lp-forest)] p-6 text-[var(--lp-cream)] sm:p-8 lg:sticky lg:top-6"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[rgba(246,242,233,0.1)] text-[var(--lp-green)]">
                <Icon className="size-5" />
              </span>
              <span className="lp-mono truncate text-[12px] uppercase text-[var(--lp-green)]">{look.label}</span>
            </span>
            <span className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold ${status.tone}`}>{status.text}</span>
          </div>

          {activity.type === 'security' ? (
            <h1 className="lp-display mt-10 text-balance text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.03em]">
              {activity.note || 'Account security update'}
            </h1>
          ) : (
            <h1 className="lp-display mt-10 flex flex-wrap items-baseline gap-x-3 text-[clamp(44px,8vw,80px)] leading-[0.9] tracking-[-0.05em] tabular-nums">
              {look.sign}
              {activity.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
              <span className="lp-serif text-[clamp(20px,2.4vw,28px)] tracking-[-0.01em] text-[#cfe0d6]">{activity.asset}</span>
            </h1>
          )}

          <p className="mt-4 text-[15px] leading-[1.5] text-[#cfe0d6]">
            {activity.type === 'security'
              ? format(new Date(activity.timestamp), 'd MMMM yyyy, HH:mm')
              : activity.type === 'bridge' && activity.sourceChain
                ? `${chainLabel(activity.sourceChain)} → ${chainLabel(activity.destChain ?? 'base')}`
                : `${isOutgoing ? 'To' : 'From'} ${shortenDetail(counterparty)}`}
          </p>

          {activity.fiatAmount != null && activity.fiatCurrency && (
            <p className="lp-mono mt-6 border-t border-[rgba(246,242,233,0.12)] pt-4 text-[12px] uppercase text-[#a9c2b5]">
              {isOutgoing ? 'Paid out' : 'Worth'} · {activity.fiatAmount.toLocaleString()} {activity.fiatCurrency}
            </p>
          )}
        </motion.section>

        {/* ── Details ───────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.06 }}
          className="min-w-0 space-y-4"
        >
          <section className={`${card} divide-y divide-[var(--lp-line)]`} aria-label="Details">
            {detailRows.map((r) => (
              <DetailRow key={r.label} {...r} />
            ))}
          </section>

          {activity.note && activity.type !== 'security' && (
            <section className="rounded-[24px] bg-[var(--lp-sand)] px-5 py-4 sm:px-6">
              <p className="lp-mono text-[11.5px] uppercase text-[var(--lp-muted)]">Note</p>
              <p className="mt-1.5 break-words text-[15px] leading-[1.55] [overflow-wrap:anywhere]">{activity.note}</p>
            </section>
          )}

          {(burnExplorer || bridgeAction) && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {burnExplorer && (
                <a
                  href={burnExplorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${pill} bg-white shadow-[0_0_0_1px_rgb(17_26_19/0.12)] hover:shadow-[0_0_0_1px_rgb(17_26_19/0.4)]`}
                >
                  <ExternalLink className="size-4" />
                  {activity.type === 'bridge' ? 'Where it left' : 'View on explorer'}
                </a>
              )}
              {bridgeAction === 'mint' && (
                <a
                  href={mintExplorer || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${pill} bg-white shadow-[0_0_0_1px_rgb(17_26_19/0.12)] hover:shadow-[0_0_0_1px_rgb(17_26_19/0.4)]`}
                >
                  <ExternalLink className="size-4" /> Where it arrived
                </a>
              )}
              {(bridgeAction === 'claimed' || bridgeAction === 'recent') && (
                <div className={`${pill} bg-[#cdf5de] text-[#0e7a45]`}>
                  <Check className="size-4" /> {bridgeAction === 'claimed' ? 'Arrived' : 'Completed'}
                </div>
              )}
              {bridgeAction === 'claim' && (
                <button type="button" onClick={handleClaim} disabled={isClaiming} className={`${pill} bg-[var(--lp-green)] text-[var(--lp-ink)]`}>
                  {isClaiming && <Loader2 className="size-4 animate-spin" />}
                  {isClaiming ? 'Finishing…' : 'Finish this move'}
                </button>
              )}
            </div>
          )}

          {activity.type !== 'security' && <ReceiptActions data={receiptData} />}

          {advancedRows.length > 0 && (
            <section className={card}>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className="flex w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span className="text-[15px] font-semibold">Technical details</span>
                <ChevronDown className={`size-4 text-[var(--lp-muted)] transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>
              {showAdvanced && (
                <div className="divide-y divide-[var(--lp-line)] border-t border-[var(--lp-line)] animate-in fade-in slide-in-from-top-1 duration-200">
                  {advancedRows.map((r) => (
                    <DetailRow key={r.label} {...r} />
                  ))}
                </div>
              )}
            </section>
          )}
        </motion.div>
      </div>
    </div>
  );
}
