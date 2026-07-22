'use client';

import { use, useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardPageHeader } from '@/components/layout/DashboardPageHeader';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from '@privy-io/react-auth/solana';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { buildReceiveMessageOnSolanaTx } from '@/lib/circle/solana-gateway';
import bs58 from 'bs58';
import Link from 'next/link';

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
import { format } from 'date-fns';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Landmark,
  Loader2,
  MessageSquare,
  Network,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useActivities } from '@/hooks/useActivities';
import { useQueryClient } from '@tanstack/react-query';
import { CHAIN_META } from '@/components/deposit-withdraw/deposit-shared';
import { ReceiptActions } from '@/components/receipt/ReceiptActions';
import { activityToReceiptData } from '@/lib/receipt/utils';
import { getOffRampRate } from '@/lib/actions/ramp';
import { executeReceiveMessage } from '@/lib/web3/bridge-actions';
import type { ActivityType } from '@/components/HistoryModule';
import { CCTP_DOMAINS, type SupportedChain } from '@/lib/circle/gateway';
import { classifyAppError } from '@/lib/errors/appErrors';

const BASE_EXPLORER = 'https://basescan.org/tx/';

/** Middle-truncate long values (hashes / ids) for display; the full value is still copied. */
function shorten(v: string, head = 10, tail = 8): string {
  return v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}

/** A single advanced-details row: label + monospace value with copy (and optional explorer link). */
function AdvancedRow({
  label,
  value,
  display,
  copyable,
  href,
}: {
  label: string;
  value: string;
  display?: string;
  copyable?: boolean;
  href?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/30 shrink-0">
        {label}
      </span>
      <span className="flex items-center gap-2 min-w-0">
        <span className="text-xs font-medium text-brand-secondary/80 font-mono truncate">
          {display ?? value}
        </span>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-secondary/30 hover:text-accent transition-colors shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {copyable && (
          <button
            onClick={copy}
            className="text-brand-secondary/30 hover:text-accent transition-colors shrink-0"
            aria-label={`Copy ${label}`}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-accent" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </span>
    </div>
  );
}

const TYPE_META: Record<
  ActivityType,
  { label: string; color: string; Icon: React.ElementType }
> = {
  sent: { label: 'Transfer Sent', color: '#f87171', Icon: ArrowUpRight },
  received: { label: 'Funds Received', color: '#00e87a', Icon: ArrowDownLeft },
  deposit: { label: 'Deposit', color: '#3b82f6', Icon: Wallet },
  withdrawal: { label: 'Withdrawal', color: '#fb923c', Icon: Landmark },
  bridge: { label: 'Bridge Transfer', color: '#60a5fa', Icon: RefreshCw },
  security: { label: 'Security Alert', color: '#f59e0b', Icon: ShieldAlert },
};

const SUCCESS_STATUSES = ['settled', 'completed', 'confirmed', 'success', 'complete'];

export default function ActivityDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const router = useRouter();
  const isPromise =
    params && typeof (params as Promise<{ id: string }>).then === 'function';
  const { id } = isPromise ? use(params as Promise<{ id: string }>) : (params as { id: string });

  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction } = useSignTransaction();
  const userEmail = user?.email?.address || '';
  const queryClient = useQueryClient();

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
        const notifs = (data.notifications || []) as any[];
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
        toast.error('Embedded wallet not found. Please log in.');
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
        toast.error('Invalid bridge source chain.');
        setIsClaiming(false);
        return;
      }

      // ── Fast path: already minted ────────────────────────────────────────
      if (activity.mintTxHash) {
        toast.info('This bridge was already completed. Refreshing status...');
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
      toast.info('Checking bridge status...');
      const res = await fetch(
        `/api/bridge/status?txHash=${activity.txHash}&sourceChain=${sourceChain}`,
      );
      if (!res.ok) throw new Error(`Status API error: ${res.statusText}`);
      const data = await res.json();

      if (!data || data.status === 'not_found') {
        toast.error('Bridge transaction not found on Circle. Please check the transaction hash.');
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
          ? 'Block finality almost reached — nearly there.'
          : 'Waiting for block confirmations on the source chain.';
        toast.error(`${chainDisplay} bridge is still being verified. ${detail} Try again in ${wait}.`, { duration: 8000 });
        setIsClaiming(false);
        return;
      }
      if (data.status !== 'complete') {
        toast.error('Bridge is still processing. Please try again shortly.');
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
          toast.info('Finalising bridge on destination chain...');
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
          toast.info('Claiming USDC on Stellar (gas paid by sponsor)...');
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
          toast.info('Claiming USDC on Solana...');
          const solAccount = user?.linkedAccounts.find(
            (a) =>
              a.type === 'wallet' &&
              (a as { walletClientType?: string }).walletClientType === 'privy' &&
              (a as { chainType?: string }).chainType === 'solana',
          );
          const solAddress =
            solAccount && 'address' in solAccount
              ? (solAccount as { address: string }).address
              : undefined;
          const solWallet = solAddress ? solanaWallets.find((w) => w.address === solAddress) : null;
          if (!solWallet || !solAddress) throw new Error('Solana wallet not found.');

          const walletPubkey = new PublicKey(solAddress);
          const solConn = new Connection(SOLANA_RPC, 'confirmed');
          const { transaction } = await buildReceiveMessageOnSolanaTx(solConn, walletPubkey, data.messageBytes!, data.attestation!);
          const txBase64 = transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
          const sponsorRes = await fetch('/api/bridge/solana-sponsor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transaction: txBase64 }),
          });
          if (!sponsorRes.ok) {
            const errData = await sponsorRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to sponsor Solana claim transaction');
          }
          const { sponsoredTransaction } = await sponsorRes.json();
          const sponsoredTx = Transaction.from(Buffer.from(sponsoredTransaction, 'base64'));
          toast.info('Approve the popup to claim USDC on Solana.');
          const { signedTransaction: signedBytes } = await signTransaction({ transaction: sponsoredTx.serialize({ requireAllSignatures: false }), wallet: solWallet });
          const signature = await solConn.sendRawTransaction(signedBytes, { skipPreflight: false, preflightCommitment: 'confirmed' });
          const lb = await solConn.getLatestBlockhash();
          await solConn.confirmTransaction({ signature, blockhash: lb.blockhash, lastValidBlockHeight: lb.lastValidBlockHeight }, 'confirmed');
          mintTxHash = signature;
        }
      }

      await fetch('/api/bridge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ burnTxHash: activity.txHash, mintTxHash }),
      }).catch(() => {});

      toast.success('Bridge complete! USDC has arrived on the destination chain.');
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
        toast.info('Your USDC has already been delivered. Saving mint hash...');
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
  if (isLoading && !activity) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-white/20" />
      </div>
    );
  }

  if (!activity) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center space-y-6">
        <p className="text-sm text-white/40">Transaction not found.</p>
        <Link
          href="/dashboard/history"
          className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to history
        </Link>
      </div>
    );
  }

  const meta = TYPE_META[activity.type as ActivityType] || { label: 'Activity', color: '#00e87a', Icon: RefreshCw };
  const isSuccess = SUCCESS_STATUSES.includes(activity.status.toLowerCase());
  const color = isSuccess ? '#00e87a' : meta.color;
  const isOutgoing = activity.type === 'sent' || activity.type === 'withdrawal';

  // Network(s): accurate for bridges; transfers don't persist their chain yet.
  const sourceMeta = activity.sourceChain
    ? CHAIN_META[activity.sourceChain.toLowerCase()]
    : null;
  const burnExplorer = activity.txHash
    ? (sourceMeta ? sourceMeta.explorerTx(activity.txHash) : `${BASE_EXPLORER}${activity.txHash}`)
    : null;

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

  const detailRows: { label: string; value: string; icon: React.ElementType }[] = [
    {
      icon: Clock,
      label: 'Date',
      value: format(new Date(activity.timestamp), 'MMMM dd, yyyy @ HH:mm'),
    },
  ];

  if (activity.type === 'security') {
    detailRows.push({
      icon: ShieldAlert,
      label: 'Details',
      value: activity.details,
    });
  } else {
    detailRows.push({
      icon: isOutgoing ? ArrowUpRight : ArrowDownLeft,
      label: isOutgoing ? 'To' : 'From',
      value: activity.details,
    });
  }
  const chainLabel = (chain: string) =>
    (CHAIN_META[chain.toLowerCase()]?.name ?? chain).toUpperCase();

  if (activity.type === 'bridge' && activity.sourceChain) {
    detailRows.push({
      icon: Network,
      label: 'Route',
      value: `${chainLabel(activity.sourceChain)} → ${chainLabel(activity.destChain ?? 'base')}`,
    });
  } else if (activity.type === 'withdrawal' && activity.consolidated) {
    // Funds were spread across networks, auto-bridged onto the settlement chain, then off-ramped.
    detailRows.push({
      icon: Network,
      label: 'Route',
      value: `YOUR NETWORKS → ${chainLabel(activity.sourceChain ?? 'base')}`,
    });
  } else if (activity.sourceChain) {
    detailRows.push({
      icon: Network,
      label: 'Network',
      value: chainLabel(activity.sourceChain),
    });
  }
  if (activity.fiatAmount != null && activity.fiatCurrency) {
    detailRows.push({
      icon: Landmark,
      label: 'Fiat',
      value: `${activity.fiatAmount.toLocaleString()} ${activity.fiatCurrency}`,
    });
  }

  // ── Advanced details: provider refs, full hashes, rate, timestamps ───────────
  const mintExplorer = activity.mintTxHash
    ? (activity.destChain ? CHAIN_META[activity.destChain.toLowerCase()] : null)?.explorerTx(
        activity.mintTxHash,
      ) ?? `${BASE_EXPLORER}${activity.mintTxHash}`
    : null;

  type AdvRow = { label: string; value: string; display?: string; copyable?: boolean; href?: string };
  const advancedRows: AdvRow[] = [];

  if (activity.provider) {
    const label = activity.provider === 'onchain' ? 'On-chain' : activity.provider;
    advancedRows.push({ label: 'Settled via', value: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  if (activity.providerOrderId) {
    advancedRows.push({ label: 'Order ID', value: activity.providerOrderId, display: shorten(activity.providerOrderId), copyable: true });
  }
  if (activity.providerRef) {
    advancedRows.push({ label: 'Payout quote', value: activity.providerRef, display: shorten(activity.providerRef), copyable: true });
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
  advancedRows.push({ label: 'Reference', value: activity.id, display: shorten(activity.id, 12, 6), copyable: true });
  if (activity.txHash) {
    advancedRows.push({
      label: activity.type === 'bridge' ? 'Burn tx' : 'Transaction',
      value: activity.txHash,
      display: shorten(activity.txHash),
      copyable: true,
      href: burnExplorer ?? undefined,
    });
  }
  if (activity.mintTxHash) {
    advancedRows.push({ label: 'Mint tx', value: activity.mintTxHash, display: shorten(activity.mintTxHash), copyable: true, href: mintExplorer ?? undefined });
  }
  advancedRows.push({
    label: 'Created',
    value: format(new Date(activity.timestamp), 'MMM dd, yyyy @ HH:mm:ss'),
  });
  if (activity.updatedAt && activity.updatedAt !== activity.timestamp) {
    advancedRows.push({
      label: 'Updated',
      value: format(new Date(activity.updatedAt), 'MMM dd, yyyy @ HH:mm:ss'),
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/history"
          className="w-11 h-11 rounded-2xl flex items-center justify-center border border-white/8 hover:bg-white/5 transition-all text-brand-secondary/60"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-brand-secondary">
            {activity.type === 'security' ? 'Security Alert' : 'Transaction'}
          </h1>
          <code className="text-[10px] font-bold uppercase tracking-widest text-brand-secondary/25">
            REF: {activity.id.slice(0, 18)}
          </code>
        </div>
      </div>

      {/* Hero */}
      <div className="card-glass p-10 text-center space-y-6 relative overflow-hidden">
        <div
          className="absolute top-0 right-0 w-40 h-40 blur-3xl rounded-full opacity-[0.08]"
          style={{ background: color }}
        />
        <div className="flex justify-center">
          <div
            className="w-20 h-20 rounded-4xl flex items-center justify-center"
            style={{ background: `${color}1a`, color, border: `1px solid ${color}33` }}
          >
            <meta.Icon className="w-10 h-10" />
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/30">
            {meta.label}
          </p>
          {activity.type === 'security' ? (
            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-brand-secondary max-w-lg mx-auto">
              {activity.note || 'Account Security Update'}
            </h2>
          ) : (
            <h2 className="font-display text-5xl font-bold tracking-tighter text-brand-secondary">
              {isOutgoing ? '−' : '+'}
              {activity.amount.toLocaleString()}{' '}
              <span className="text-xl opacity-30 font-bold uppercase">{activity.asset}</span>
            </h2>
          )}
          <div className="flex justify-center pt-1">
            <span
              className="px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest"
              style={{ background: `${color}14`, color, border: `1px solid ${color}33` }}
            >
              {activity.status}
            </span>
          </div>
        </div>
      </div>

      {/* Detail rows */}
      <div className="grid sm:grid-cols-2 gap-3">
        {detailRows.map((r) => (
          <div key={r.label} className="p-4 rounded-2xl bg-white/2 border border-white/6">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-2 text-brand-secondary/25">
              <r.icon className="w-3 h-3" /> {r.label}
            </p>
            <p className="text-sm font-semibold text-brand-secondary break-words">{r.value}</p>
          </div>
        ))}
      </div>

      {activity.note && activity.type !== 'security' && (
        <div className="p-4 rounded-2xl bg-accent/5 border border-accent/10">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1 flex items-center gap-2 text-accent">
            <MessageSquare className="w-3 h-3" /> Memo
          </p>
          <p className="text-sm font-medium leading-relaxed text-brand-secondary/80">
            {activity.note}
          </p>
        </div>
      )}

      {/* On-chain transactions */}
      {(activity.txHash || activity.mintTxHash) && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/25 px-1">
            On-chain
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {burnExplorer && (
              <a
                href={burnExplorer}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {activity.type === 'bridge' ? 'Burn transaction' : 'View on explorer'}
              </a>
            )}
            {activity.type === 'bridge' &&
              (activity.mintTxHash ? (
                <a
                  href={
                    (activity.destChain
                      ? CHAIN_META[activity.destChain.toLowerCase()]
                      : null
                    )?.explorerTx(activity.mintTxHash) ??
                    `${BASE_EXPLORER}${activity.mintTxHash}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest bg-white/6 text-brand-secondary border border-white/10 hover:bg-white/10 transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Mint transaction
                </a>
              ) : claimSuccess ? (
                <div className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Check className="w-3.5 h-3.5" /> Claimed Successfully
                </div>
              ) : activity.status === 'complete' && Date.now() - new Date(activity.timestamp).getTime() < 10 * 60 * 1000 ? (
                <div className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Check className="w-3.5 h-3.5" /> Completed
                </div>
              ) : (
                <button
                  onClick={handleClaim}
                  disabled={isClaiming}
                  className="flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-[10px] uppercase tracking-widest btn-accent disabled:opacity-50"
                >
                  {isClaiming ? 'Claiming…' : 'Claim USDC'}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Receipt */}
      {activity.type !== 'security' && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/25 px-1">
            Receipt
          </p>
          <ReceiptActions data={receiptData} />
        </div>
      )}

      {/* Advanced details */}
      {advancedRows.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="w-full flex items-center justify-between px-1 group"
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-secondary/25 group-hover:text-brand-secondary/40 transition-colors">
              Advanced details
            </span>
            <ChevronDown
              className={
                'w-4 h-4 text-brand-secondary/30 transition-transform ' +
                (showAdvanced ? 'rotate-180' : '')
              }
            />
          </button>
          {showAdvanced && (
            <div className="card-glass px-4 py-1 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-200">
              {advancedRows.map((r) => (
                <AdvancedRow key={r.label} {...r} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
