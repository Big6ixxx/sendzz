'use client';

import {
  calculateMaxFee,
  CCTP_DOMAINS,
  CHAIN_NAMES,
  fetchCctpFees,
  getCCTPDepositInstructions,
  SOURCE_CHAINS,
  TOKEN_MESSENGER_V2,
  USDC_ADDRESSES,
  type SupportedChain,
} from '@/lib/circle/gateway';
import { cn } from '@/lib/utils';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

interface CctpDepositFormProps {
  userAddress: string;
}

type CctpStep = 'configure' | 'instructions' | 'monitoring' | 'success';

export function CctpDepositForm({ userAddress }: CctpDepositFormProps) {
  const [step, setStep] = useState<CctpStep>('configure');
  const [sourceChain, setSourceChain] = useState<SupportedChain>('arbitrum');
  const [amount, setAmount] = useState('');
  const [burnTxHash, setBurnTxHash] = useState('');
  const [messageHash, setMessageHash] = useState('');
  const [monitorStatus, setMonitorStatus] = useState(
    'Waiting for Circle attestation...',
  );
  const [mintTxHash, setMintTxHash] = useState('');
  const [error, setError] = useState('');
  const [fee, setFee] = useState<{ bps: number; usdc: string } | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [maxFeeRaw, setMaxFeeRaw] = useState<string>('');
  const [showAdvanceHash, setShowAdvanceHash] = useState(false);

  // Fetch live fee from Circle Iris API when chain or amount changes
  useEffect(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setFee(null);
      return;
    }

    const timeout = setTimeout(async () => {
      setFeeLoading(true);
      try {
        const sourceDomain = CCTP_DOMAINS[sourceChain];
        const fees = await fetchCctpFees(sourceDomain, CCTP_DOMAINS.base);
        const fastFee =
          fees.find((f) => f.finalityThreshold === 1000) ?? fees[0];
        const bps = fastFee.minimumFee;
        const feeUsdc = ((parseFloat(amount) * bps) / 10000).toFixed(4);
        setFee({ bps, usdc: feeUsdc });

        // Pre-calculate maxFee for the instructions step
        const maxFee = await calculateMaxFee(sourceChain, amount);
        setMaxFeeRaw(maxFee.toString());
      } catch {
        setFee(null);
      } finally {
        setFeeLoading(false);
      }
    }, 600);

    return () => clearTimeout(timeout);
  }, [sourceChain, amount]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const instructions = amount
    ? getCCTPDepositInstructions(sourceChain, amount, userAddress)
    : null;

  const handleContinueToInstructions = () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }
    setError('');
    setStep('instructions');
  };

  // Poll Circle Iris for attestation via our lightweight server proxy
  const handleStartMonitoring = async () => {
    if (!messageHash && !burnTxHash.startsWith('0x')) {
      setError('Please enter a valid burn transaction hash');
      return;
    }

    setError('');
    setStep('monitoring');
    setMonitorStatus('Waiting for Circle attestation...');

    // Use messageHash if provided, otherwise fallback to burnTxHash
    const hashToPoll = messageHash || burnTxHash;

    let attempts = 0;
    const MAX_ATTEMPTS = 360; // 30 min at 5s intervals

    const poll = async () => {
      attempts++;

      if (attempts > MAX_ATTEMPTS) {
        setMonitorStatus(
          'Attestation is taking longer than usual. Circle will complete it — you can close this page.',
        );
        return;
      }

      try {
        const res = await fetch(`/api/bridge/status?messageHash=${hashToPoll}`);
        const data = await res.json();

        if (data.status === 'complete') {
          setMintTxHash(data.mintTxHash || '');
          setStep('success');
          toast.success('USDC bridged to Base! 🎉');
          return;
        }

        setMonitorStatus(
          `Waiting for Circle attestation... (${attempts * 5}s elapsed)`,
        );
        setTimeout(poll, 5000);
      } catch {
        setTimeout(poll, 10000);
      }
    };

    poll();
  };

  // Step 1: Configure
  if (step === 'configure') {
    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Info callout */}
        <div
          className="flex gap-3 p-4 rounded-xl text-xs"
          style={{
            background: 'rgba(0,232,122,0.06)',
            border: '1px solid rgba(0,232,122,0.15)',
          }}
        >
          <Info
            className="w-4 h-4 shrink-0 mt-0.5"
            style={{ color: '#00e87a' }}
          />
          <p style={{ color: 'rgba(248,248,246,0.6)' }}>
            Send USDC from any chain directly to your Base wallet using Circle
            CCTP. Circle&apos;s relayer handles the mint automatically — no gas
            required on your end.
          </p>
        </div>

        <div className="space-y-4">
          {/* Source Chain */}
          <div>
            <label
              className="text-xs font-semibold mb-2 block"
              style={{ color: 'rgba(248,248,246,0.4)' }}
            >
              Source Chain
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SOURCE_CHAINS.map((chain) => (
                <button
                  key={chain}
                  type="button"
                  onClick={() => setSourceChain(chain)}
                  className={cn(
                    'p-3 rounded-xl text-sm font-semibold transition-all text-left',
                  )}
                  style={{
                    background:
                      sourceChain === chain
                        ? 'rgba(0,232,122,0.12)'
                        : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${sourceChain === chain ? 'rgba(0,232,122,0.3)' : 'rgba(255,255,255,0.06)'}`,
                    color:
                      sourceChain === chain
                        ? '#00e87a'
                        : 'rgba(248,248,246,0.5)',
                  }}
                >
                  {CHAIN_NAMES[chain]}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label
              className="text-xs font-semibold mb-1.5 block"
              style={{ color: 'rgba(248,248,246,0.4)' }}
            >
              Amount (USDC)
            </label>
            <div className="relative">
              <span
                className="absolute left-4 top-1/2 -translate-y-1/2 font-bold"
                style={{ color: 'rgba(248,248,246,0.3)' }}
              >
                $
              </span>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="input-elegant pl-8 text-xl font-bold"
                placeholder="100.00"
              />
            </div>
          </div>

          {/* Live fee display */}
          {amount && parseFloat(amount) > 0 && (
            <div
              className="p-3 rounded-xl flex justify-between items-center text-xs"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div
                className="flex items-center gap-2"
                style={{ color: 'rgba(248,248,246,0.4)' }}
              >
                <Zap className="w-3.5 h-3.5" style={{ color: '#00e87a' }} />
                Fast Transfer Fee (Circle CCTP)
              </div>
              <span className="font-bold" style={{ color: '#f8f8f6' }}>
                {feeLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin inline" />
                ) : fee ? (
                  `~$${fee.usdc} USDC`
                ) : (
                  'Unavailable'
                )}
              </span>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs font-bold text-red-400 uppercase">{error}</p>
        )}

        <button
          onClick={handleContinueToInstructions}
          disabled={!amount}
          className="btn-accent w-full gap-2"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  // Step 2: Instructions + burn tx input
  if (step === 'instructions' && instructions) {
    return (
      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Info card */}
        <div
          className="p-5 rounded-2xl space-y-4"
          style={{
            background: 'rgba(10,10,11,0.8)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'rgba(248,248,246,0.3)' }}
          >
            Bridge {amount} USDC from {CHAIN_NAMES[sourceChain]} → Base
          </p>

          <div
            className="space-y-3 pt-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            {[
              {
                label: 'USDC on ' + CHAIN_NAMES[sourceChain],
                value: USDC_ADDRESSES[sourceChain],
              },
              { label: 'TokenMessengerV2', value: TOKEN_MESSENGER_V2 },
              { label: 'Your Base Address', value: userAddress },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-center text-xs"
              >
                <span style={{ color: 'rgba(248,248,246,0.35)' }}>{label}</span>
                <button
                  onClick={() => copy(value, label)}
                  className="font-mono font-bold flex items-center gap-1.5 transition-opacity hover:opacity-70"
                  style={{ color: 'rgba(248,248,246,0.7)' }}
                >
                  {value.slice(0, 8)}...{value.slice(-6)}
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ))}

            {maxFeeRaw && (
              <div className="flex justify-between items-center text-xs">
                <span style={{ color: 'rgba(248,248,246,0.35)' }}>
                  maxFee (subunits)
                </span>
                <button
                  onClick={() => copy(maxFeeRaw, 'maxFee')}
                  className="font-mono font-bold flex items-center gap-1.5 hover:opacity-70"
                  style={{ color: '#00e87a' }}
                >
                  {maxFeeRaw}
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Steps */}
        <div
          className="p-4 rounded-xl space-y-3"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'rgba(248,248,246,0.3)' }}
          >
            Steps to complete in your wallet
          </p>
          <ol
            className="space-y-2.5 text-xs"
            style={{ color: 'rgba(248,248,246,0.5)' }}
          >
            <li className="flex gap-2">
              <span
                className="font-black shrink-0"
                style={{ color: '#f8f8f6' }}
              >
                1.
              </span>
              Approve <span className="font-mono">{amount} USDC</span> for{' '}
              <span className="font-mono text-[10px]">
                {TOKEN_MESSENGER_V2.slice(0, 10)}...
              </span>
            </li>
            <li className="flex gap-2">
              <span
                className="font-black shrink-0"
                style={{ color: '#f8f8f6' }}
              >
                2.
              </span>
              Call{' '}
              <code
                className="text-[10px] font-mono px-1 py-0.5 rounded"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                depositForBurn
              </code>{' '}
              with destination domain{' '}
              <strong style={{ color: '#f8f8f6' }}>{CCTP_DOMAINS.base}</strong>{' '}
              (Base) and{' '}
              <code
                className="font-mono text-[10px] px-1 rounded"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                maxFee = {maxFeeRaw}
              </code>
            </li>
            <li className="flex gap-2">
              <span
                className="font-black shrink-0"
                style={{ color: '#f8f8f6' }}
              >
                3.
              </span>
              Paste the burn tx hash below. Circle&apos;s relayer will mint USDC
              on Base automatically.
            </li>
          </ol>
        </div>

        {/* Burn tx hash input */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              className="text-xs font-semibold block"
              style={{ color: 'rgba(248,248,246,0.4)' }}
            >
              Burn Transaction Hash (required)
            </label>
            <input
              type="text"
              value={burnTxHash}
              onChange={(e) => setBurnTxHash(e.target.value)}
              className="input-elegant text-sm font-mono"
              placeholder="0x..."
            />
          </div>

          {!showAdvanceHash ? (
            <button
              onClick={() => setShowAdvanceHash(true)}
              className="text-[10px] font-bold uppercase tracking-widest opacity-30 hover:opacity-100 transition-opacity"
            >
              + Use Message Hash Instead
            </button>
          ) : (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
              <label
                className="text-xs font-semibold block"
                style={{ color: 'rgba(248,248,246,0.4)' }}
              >
                Message Hash (Optional)
              </label>
              <input
                type="text"
                value={messageHash}
                onChange={(e) => setMessageHash(e.target.value)}
                className="input-elegant text-sm font-mono"
                placeholder="0x..."
              />
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs font-bold text-red-400 uppercase">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => {
              setStep('configure');
              setError('');
            }}
            className="btn-secondary flex-1"
          >
            Back
          </button>
          <button
            onClick={handleStartMonitoring}
            disabled={!burnTxHash}
            className="btn-accent flex-1 gap-2"
          >
            Track Bridge
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Monitoring
  if (step === 'monitoring') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center space-y-6 animate-in fade-in duration-500">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Loader2
            className="w-10 h-10 animate-spin"
            style={{ color: '#00e87a' }}
          />
        </div>
        <div className="space-y-2">
          <h2
            className="font-display text-2xl font-bold"
            style={{ color: '#f8f8f6' }}
          >
            Bridging USDC
          </h2>
          <p
            className="text-sm max-w-xs"
            style={{ color: 'rgba(248,248,246,0.4)' }}
          >
            Circle&apos;s relayer is processing your transfer. You can safely
            close this page — USDC will arrive in your Base wallet
            automatically.
          </p>
        </div>
        <div
          className="p-3 rounded-xl w-full"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          <p
            className="text-[10px] font-bold uppercase tracking-widest"
            style={{ color: 'rgba(248,248,246,0.35)' }}
          >
            {monitorStatus}
          </p>
        </div>
        <p className="text-[10px]" style={{ color: 'rgba(248,248,246,0.2)' }}>
          Fast Transfers: ~20 minutes · Standard: up to 2 hours
        </p>
      </div>
    );
  }

  // Step 4: Success
  if (step === 'success') {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center space-y-6 animate-in zoom-in duration-500">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center shadow-lg"
          style={{
            background: '#00e87a',
            color: '#07070a',
            boxShadow: '0 12px 40px rgba(0,232,122,0.3)',
          }}
        >
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h2
            className="font-display text-3xl font-bold"
            style={{ color: '#f8f8f6' }}
          >
            Bridge Complete!
          </h2>
          <p style={{ color: 'rgba(248,248,246,0.5)', fontSize: '0.9rem' }}>
            {amount} USDC has arrived in your Base wallet.
          </p>
        </div>
        {mintTxHash && (
          <a
            href={`https://basescan.org/tx/${mintTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary h-12 px-6 text-xs gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            View on BaseScan
          </a>
        )}
        <button
          onClick={() => window.location.reload()}
          className="btn-accent px-10"
        >
          View Dashboard
        </button>
      </div>
    );
  }

  return null;
}
