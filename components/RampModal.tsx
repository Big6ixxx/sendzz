'use client';

import { useState } from 'react';
import { Loader2, X, ArrowUpRight, ArrowDownLeft, Landmark } from 'lucide-react';
import { initiateOnRamp, getOffRampQuote, finalizeOffRamp } from '@/lib/actions/ramp';

interface RampModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userAddress: string;
  type: 'onramp' | 'offramp';
}

export function RampModal({ isOpen, onClose, userId, userAddress, type }: RampModalProps) {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [quote, setQuote] = useState<any>(null);
  const [bankDetails, setBankDetails] = useState({ accountNumber: '', bankCode: '' });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleOnRamp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const url = await initiateOnRamp(parseFloat(amount), userId, userAddress);
      window.location.href = url;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleGetOffRampQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await getOffRampQuote(parseFloat(amount));
      setQuote(res);
      setStep(2);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleFinalizeOffRamp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await finalizeOffRamp(quote.id, bankDetails.accountNumber, bankDetails.bankCode);
      setStep(3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="brutal-card w-full max-w-md bg-white text-black p-6 md:p-8 relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 hover:rotate-90 transition-transform"
        >
          <X className="w-8 h-8" />
        </button>

        <div className="mb-8 border-b-4 border-black pb-4">
          <h2 className="font-oswald text-3xl uppercase font-black flex items-center gap-3">
            {type === 'onramp' ? <ArrowDownLeft className="text-neon bg-black p-1" /> : <ArrowUpRight className="text-black bg-neon p-1" />}
            {type === 'onramp' ? 'Deposit Capital' : 'Withdraw Capital'}
          </h2>
          <p className="font-mono text-xs uppercase font-bold mt-2">
            Protocol: Bitnob {type === 'onramp' ? 'Checkout' : 'Payout'} (NGN)
          </p>
        </div>

        {error && (
          <div className="bg-red-500 text-white p-4 mb-6 font-mono text-sm border-2 border-black uppercase font-bold text-center">
            !! ERROR: {error}
          </div>
        )}

        {type === 'onramp' ? (
          <form onSubmit={handleOnRamp} className="flex flex-col gap-6">
            <div>
              <label className="font-mono text-sm font-bold uppercase block mb-2 text-gray-600">Amount (NGN)</label>
              <input 
                type="number" 
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="brutal-input text-2xl font-black" 
                placeholder="5000.00"
                required
              />
            </div>
            <button 
              type="submit" 
              disabled={loading}
              className="brutal-btn flex items-center justify-center gap-4 w-full"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'INITIATE DEPOSIT'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-6">
            {step === 1 && (
              <form onSubmit={handleGetOffRampQuote} className="flex flex-col gap-6">
                <div>
                  <label className="font-mono text-sm font-bold uppercase block mb-2 text-gray-600">Amount (USDC)</label>
                  <input 
                    type="number" 
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="brutal-input text-2xl font-black" 
                    placeholder="10.00"
                    required
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={loading}
                  className="brutal-btn flex items-center justify-center gap-4 w-full"
                >
                  {loading ? <Loader2 className="animate-spin" /> : 'REQUEST QUOTE'}
                </button>
              </form>
            )}

            {step === 2 && quote && (
              <form onSubmit={handleFinalizeOffRamp} className="flex flex-col gap-6 font-mono">
                <div className="bg-neon/20 p-4 border-2 border-black text-sm">
                  <div className="flex justify-between border-b border-black/10 pb-1 mb-1">
                    <span>RATE:</span>
                    <span className="font-bold">1 USDC = {quote.rate} NGN</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ESTIMATED RECEIVE:</span>
                    <span className="font-bold">{quote.payoutAmount} NGN</span>
                  </div>
                </div>

                <div>
                  <label className="font-mono text-xs font-bold uppercase block mb-1">Account Number</label>
                  <input 
                    type="text" 
                    value={bankDetails.accountNumber}
                    onChange={e => setBankDetails({...bankDetails, accountNumber: e.target.value})}
                    className="brutal-input p-2! text-lg" 
                    required
                  />
                </div>

                <div>
                  <label className="font-mono text-xs font-bold uppercase block mb-1">Bank Code</label>
                  <input 
                    type="text" 
                    value={bankDetails.bankCode}
                    onChange={e => setBankDetails({...bankDetails, bankCode: e.target.value})}
                    className="brutal-input p-2! text-lg" 
                    placeholder="044"
                    required
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={loading}
                  className="brutal-btn flex items-center justify-center gap-4 w-full"
                >
                  {loading ? <Loader2 className="animate-spin" /> : 'FINALIZE WITHDRAWAL'}
                </button>
              </form>
            )}

            {step === 3 && (
               <div className="text-center py-8">
                 <div className="bg-black text-neon p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
                    <Landmark className="w-10 h-10" />
                 </div>
                 <h3 className="font-oswald text-2xl font-black uppercase mb-4">Payout Initiated</h3>
                 <p className="font-mono text-sm text-gray-600 mb-8">
                   Bitnob has registered your payout request. Please follow up on your wallet to confirm the transfer.
                 </p>
                 <button onClick={onClose} className="brutal-btn w-full">CLOSE TERMINAL</button>
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
