'use client';

import {
  calculateMaxFee,
  CCTP_DOMAINS,
  CHAIN_IDS,
  CHAIN_NAMES,
  fetchCctpFees,
  SOURCE_CHAINS,
  TOKEN_MESSENGER_V2,
  USDC_ADDRESSES,
  type SupportedChain
} from '@/lib/circle/gateway';
import {
  recordBridgeTransaction,
  updateBridgeStatus,
} from '@/lib/supabase/actions';
import { cn, truncateAddress } from '@/lib/utils';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Zap,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  createPublicClient,
  createWalletClient,
  custom,
  parseAbi,
  parseUnits,
  type Chain,
} from 'viem';
import {
  arbitrum,
  avalanche,
  base,
  mainnet,
  optimism,
  polygon,
} from 'viem/chains';

const VIEM_CHAINS: Record<SupportedChain, Chain> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  optimism: optimism,
  polygon: polygon,
  avalanche: avalanche,
  base: base,
};

interface CctpDepositFormProps {
  userAddress: string;
  handleClose: () => void;
}

type CctpStep = 'configure' | 'monitoring' | 'success';

export function CctpDepositForm({
  userAddress,
  handleClose,
}: CctpDepositFormProps) {
  const { wallets } = useWallets();
  const { user, connectWallet } = usePrivy();
  const queryClient = useQueryClient();
  const externalWallets = wallets.filter((w) => w.walletClientType !== 'privy');
  const hasExternalWallet = externalWallets.length > 0;
  const [isExecuting, setIsExecuting] = useState(false);
  const [step, setStep] = useState<CctpStep>('configure');
  const [sourceChain, setSourceChain] = useState<SupportedChain>('arbitrum');
  const [amount, setAmount] = useState('');
  const [burnTxHash, setBurnTxHash] = useState('');
  const [monitorStatus, setMonitorStatus] = useState(
    'Waiting for Circle attestation...',
  );
  const [mintTxHash, setMintTxHash] = useState('');
  const [error, setError] = useState('');
  const [fee, setFee] = useState<{ bps: number; usdc: string } | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [maxFeeRaw, setMaxFeeRaw] = useState<string>('');

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

  const getFriendlyErrorMessage = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const shortMessage = (err as { shortMessage?: string })?.shortMessage;

    if (message.includes('User rejected') || message.includes('User denied')) {
      return 'Transaction cancelled in wallet';
    }
    if (message.includes('insufficient funds')) {
      return 'Insufficient funds for gas or bridge amount';
    }
    if (message.includes('unsupported chain ID')) {
      return `Your wallet does not seem to support ${CHAIN_NAMES[sourceChain]} (Chain ID: ${CHAIN_IDS[sourceChain]}). Please add it to your wallet and try again.`;
    }
    if (shortMessage) return shortMessage;
    return 'Transaction failed. Please try again.';
  };

  const handleBridge = async () => {
    if (!amount || parseFloat(amount) < 1) {
      setError('Minimum bridge amount is 1 USDC');
      return;
    }

    setIsExecuting(true);
    setError('');

    try {
      // 1. Get connected wallet
      const wallet = externalWallets[0];
      if (!wallet)
        throw new Error(
          'No external wallet connected. Please connect a wallet to bridge.',
        );

      // 2. Switch to correct source chain
      await wallet.switchChain(CHAIN_IDS[sourceChain]);
      const provider = await wallet.getEthereumProvider();

      const chain = VIEM_CHAINS[sourceChain];
      const client = createWalletClient({
        account: wallet.address as `0x${string}`,
        transport: custom(provider),
        chain,
      });
      const publicClient = createPublicClient({
        transport: custom(provider),
        chain,
      });

      const amountRaw = parseUnits(amount, 6);
      const usdcAddress = USDC_ADDRESSES[sourceChain] as `0x${string}`;

      // 3. Approve USDC
      setMonitorStatus('Requesting USDC approval...');
      setStep('monitoring'); // Show monitoring UI early for feedback

      const approveHash = await client.writeContract({
        chain,
        address: usdcAddress,
        abi: parseAbi([
          'function approve(address spender, uint256 amount) returns (bool)',
        ]),
        functionName: 'approve',
        args: [TOKEN_MESSENGER_V2, amountRaw],
      });

      setMonitorStatus('Waiting for approval to confirm...');
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // 4. Deposit for Burn
      setMonitorStatus('Requesting CCTP transfer...');
      const maxFeeValue = BigInt(maxFeeRaw || '0');
      const mintRecipient = ('0x' +
        '0'.repeat(24) +
        userAddress.slice(2).toLowerCase()) as `0x${string}`;
      const destinationCaller = ('0x' + '0'.repeat(64)) as `0x${string}`;

      const burnHash = await client.writeContract({
        chain,
        address: TOKEN_MESSENGER_V2 as `0x${string}`,
        abi: parseAbi([
          'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)',
        ]),
        functionName: 'depositForBurn',
        args: [
          amountRaw,
          CCTP_DOMAINS.base,
          mintRecipient,
          usdcAddress,
          destinationCaller,
          maxFeeValue,
          1000,
        ],
      });

      setMonitorStatus('Waiting for CCTP transfer to confirm...');
      await publicClient.waitForTransactionReceipt({
        hash: burnHash,
      });

      setBurnTxHash(burnHash);

      // 6. Record in DB so it shows in history
      const email = user?.email?.address || '';

      await recordBridgeTransaction({
        userEmail: email,
        sourceChain,
        destChain: 'base',
        amountUsdc: parseFloat(amount),
        burnTxHash: burnHash,
      });

      // Force history refresh
      queryClient.invalidateQueries({ queryKey: ['history'] });

      handleStartMonitoring(burnHash);
    } catch (err) {
      console.error('[CCTP Bridge Error]', err);
      setError(getFriendlyErrorMessage(err));
      setStep('configure');
    } finally {
      setIsExecuting(false);
    }
  };

  // Poll Circle Iris for attestation via our lightweight server proxy
  const handleStartMonitoring = async (bHash?: string | React.MouseEvent) => {
    const currentBurnHash = typeof bHash === 'string' ? bHash : burnTxHash;
    if (!currentBurnHash || !currentBurnHash.startsWith('0x')) {
      setError('Please enter a valid burn transaction hash');
      return;
    }

    setError('');
    setStep('monitoring');
    setMonitorStatus('Waiting for Circle attestation...');

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
        const res = await fetch(
          `/api/bridge/status?txHash=${currentBurnHash}&sourceChain=${sourceChain}`,
        );
        const data = await res.json();

        if (data.status === 'complete') {
          const mTxHash = data.mintTxHash || '';
          setMintTxHash(mTxHash);
          setStep('success');

          // Update DB status
          await updateBridgeStatus(currentBurnHash, 'complete', mTxHash);

          // Force history refresh again
          queryClient.invalidateQueries({ queryKey: ['history'] });

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
        <div className="space-y-8">
          {/* Section 1: Direct Deposit */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs">
                1
              </div>
              <h3 className="font-bold text-sm text-white">
                Direct Deposit (Easiest)
              </h3>
            </div>
            <div className="pl-8">
              <p className="text-xs text-white/40 mb-3">
                If you have USDC on a centralized exchange or a mobile wallet,
                you can send it directly to your Base address.
              </p>
              <div
                className="p-4 rounded-xl flex items-center justify-between gap-4"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div className="flex-1 overflow-hidden">
                  <p
                    className="text-sm font-medium"
                    style={{ color: '#f8f8f6' }}
                  >
                    {truncateAddress(userAddress, 8, 8)}
                  </p>
                  <button
                    onClick={() => copy(userAddress, 'Address')}
                    className="text-[10px] uppercase font-bold tracking-widest mt-1 hover:text-white transition-colors"
                    style={{ color: '#00e87a' }}
                  >
                    Copy Full Address
                  </button>
                </div>
                <div className="p-1.5 bg-white rounded-lg">
                  <QRCodeSVG
                    value={userAddress}
                    size={48}
                    level="L"
                    includeMargin={false}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="h-px w-full bg-white/5" />

          {/* Section 2: Cross-Chain Bridge */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold text-xs">
                2
              </div>
              <h3 className="font-bold text-sm text-white">
                Cross-Chain Bridge
              </h3>
            </div>
            <div className="pl-8 space-y-4">
              <p className="text-xs text-white/40">
                Bridge USDC from other networks (Arbitrum, Ethereum, etc.)
                directly to your Base wallet without paying gas on Base.
              </p>

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

              {error && (
                <p className="text-xs font-bold text-red-400 uppercase">
                  {error}
                </p>
              )}

              {!hasExternalWallet ? (
                <button
                  onClick={connectWallet}
                  className="btn-accent w-full gap-2"
                >
                  Connect Wallet to Bridge
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleBridge}
                  disabled={!amount || feeLoading || isExecuting}
                  className="btn-accent w-full gap-2"
                >
                  {isExecuting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Bridging...
                    </>
                  ) : (
                    <>
                      Bridge USDC
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Monitoring
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

  // Step 3: Success
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
          onClick={handleClose}
          className="btn-accent px-10"
        >
          View Dashboard
        </button>
      </div>
    );
  }

  return null;
}
