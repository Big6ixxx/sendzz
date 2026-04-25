'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Loader2, X, ArrowUpRight, ArrowDownLeft, Landmark, Copy, CheckCircle2, ChevronDown, Search } from 'lucide-react';
import { initiateOnRamp, getOffRampQuote, finalizeOffRamp, verifyBankAccount, getInstitutions } from '@/lib/actions/ramp';
import { toast } from 'sonner';
import { PaycrestOrderResponse, PaycrestInstitution } from '@/lib/paycrest/types';

interface RampModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userAddress: string;
  type: 'onramp' | 'offramp';
}

export function RampModal({ isOpen, onClose, userId, userAddress, type }: RampModalProps) {
  console.log('[RampModal] Rendering, isOpen:', isOpen);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  
  const [order, setOrder] = useState<PaycrestOrderResponse | null>(null);
  const [quote, setQuote] = useState<{ rate: number; payoutAmount: number } | null>(null);
  
  const [bankDetails, setBankDetails] = useState({ accountNumber: '', bankCode: '', accountName: '', bankName: '' });
  const [institutions, setInstitutions] = useState<PaycrestInstitution[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [showBankDropdown, setShowBankDropdown] = useState(false);
  
  const [error, setError] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const lastAttemptedRef = useRef<string>(''); // tracks bankCode-accountNumber

  useEffect(() => {
    if (isOpen && type === 'offramp') {
      const fetchBanks = async () => {
        try {
          const res = await getInstitutions('NGN');
          console.log('[RampModal] Institutions fetched:', res.data);
          setInstitutions(res.data);
        } catch (err) {
          console.error('Failed to fetch institutions:', err);
        }
      };
      fetchBanks();
    }
  }, [isOpen, type]);

  const filteredInstitutions = useMemo(() => {
    if (!bankSearch) return institutions;
    return institutions.filter(inst => 
      inst.name.toLowerCase().includes(bankSearch.toLowerCase())
    );
  }, [institutions, bankSearch]);

  const handleOnRamp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await initiateOnRamp(parseFloat(amount), userId, userAddress);
      setOrder(res);
      setStep(2);
    } catch (error) {
      const err = error as Error;
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGetOffRampQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await getOffRampQuote(parseFloat(amount));
      setQuote(res);
      setStep(2);
    } catch (error) {
      const err = error as Error;
      setError(err.message);
    }
    setLoading(false);
  };

  const handleVerifyAccount = useCallback(async () => {
    const attemptKey = `${bankDetails.bankCode}-${bankDetails.accountNumber}`;
    if (bankDetails.accountNumber.length !== 10 || !bankDetails.bankCode) {
      console.log('[RampModal] Skipping verification: invalid inputs', bankDetails);
      return;
    }
    
    console.log('[RampModal] Starting account verification:', attemptKey);
    setVerifying(true);
    setVerificationError('');
    lastAttemptedRef.current = attemptKey;
    
    try {
      const res = await verifyBankAccount(bankDetails.bankCode, bankDetails.accountNumber);
      console.log('[RampModal] Verification success:', res);
      // The API returns the name directly in res.data
      const name = typeof res.data === 'string' ? res.data : (res as unknown as { data: { accountName: string } }).data?.accountName;
      setBankDetails(prev => ({ ...prev, accountName: name }));
      toast.success('Account verified');
    } catch (error: unknown) {
      console.error('[RampModal] Verification error:', error);
      const err = error as Error;
      setVerificationError(err?.message || 'Could not verify account');
      toast.error('Could not verify account');
    } finally {
      setVerifying(false);
    }
  }, [bankDetails]);

  useEffect(() => {
    const { accountNumber, bankCode, accountName } = bankDetails;
    const attemptKey = `${bankCode}-${accountNumber}`;

    console.log('[RampModal] Auto-verification check:', {
      accountNumberLength: accountNumber.length,
      bankCode,
      hasAccountName: !!accountName,
      verifying,
      lastAttempt: lastAttemptedRef.current,
      attemptKey
    });

    if (
      accountNumber.length === 10 && 
      bankCode && 
      !accountName && 
      !verifying && 
      lastAttemptedRef.current !== attemptKey
    ) {
      console.log('[RampModal] TRIGGERING VERIFICATION!');
      handleVerifyAccount();
    }
  }, [bankDetails, verifying, handleVerifyAccount]);

  if (!isOpen) return null;

  const handleFinalizeOffRamp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankDetails.accountName) {
      setError('Please verify account first');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await finalizeOffRamp(
        parseFloat(amount),
        bankDetails.accountNumber,
        bankDetails.bankCode,
        bankDetails.accountName,
        userAddress
      );
      setOrder(res);
      setStep(3);
    } catch (error) {
      const err = error as Error;
      setError(err.message);
    }
    setLoading(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="brutal-card w-full max-w-md bg-white text-black p-6 md:p-8 relative max-h-[90vh] overflow-y-auto">
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
            Network: Base // Provider: Paycrest
          </p>
        </div>

        {error && (
          <div className="bg-red-500 text-white p-4 mb-6 font-mono text-sm border-2 border-black uppercase font-bold text-center">
            !! ERROR: {error}
          </div>
        )}

        {type === 'onramp' ? (
          <div className="flex flex-col gap-6">
            {step === 1 && (
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
                  {loading ? <Loader2 className="animate-spin" /> : 'GENERATE DEPOSIT ACCOUNT'}
                </button>
              </form>
            )}

            {step === 2 && order && (
              <div className="flex flex-col gap-6">
                <div className="bg-neon/10 border-4 border-black p-6 font-mono">
                  <p className="text-xs uppercase font-bold mb-4 border-b-2 border-black pb-2">Transfer exactly this amount:</p>
                  <div className="text-3xl font-black mb-4">{order.providerAccount.amountToTransfer} {order.providerAccount.currency}</div>
                  
                  <div className="space-y-4 text-sm">
                    <div className="flex justify-between items-center group cursor-pointer" onClick={() => copyToClipboard(order.providerAccount.accountIdentifier || '', 'Account Number')}>
                      <span className="opacity-60">ACCOUNT:</span>
                      <span className="font-bold flex items-center gap-2">{order.providerAccount.accountIdentifier} <Copy className="w-3 h-3" /></span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="opacity-60">BANK:</span>
                      <span className="font-bold">{order.providerAccount.institution}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="opacity-60">NAME:</span>
                      <span className="font-bold text-xs text-right">{order.providerAccount.accountName}</span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] font-mono leading-tight opacity-70">
                  * Funds will be automatically credited to your smart account once the transfer is confirmed on-chain.
                </p>
                <button onClick={onClose} className="brutal-btn w-full">I HAVE TRANSFERRED</button>
              </div>
            )}
          </div>
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
                  {loading ? <Loader2 className="animate-spin" /> : 'CHECK EXCHANGE RATE'}
                </button>
              </form>
            )}

            {step === 2 && quote && (
              <form onSubmit={handleFinalizeOffRamp} className="flex flex-col gap-6 font-mono">
                <div className="bg-black text-white p-4 border-2 border-black text-sm">
                  <div className="flex justify-between border-b border-white/10 pb-1 mb-1">
                    <span>RATE:</span>
                    <span className="font-bold text-neon">1 USDC = {quote.rate} NGN</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ESTIMATED RECEIVE:</span>
                    <span className="font-bold text-neon">{quote.payoutAmount.toLocaleString()} NGN</span>
                  </div>
                </div>

                  <div className="relative">
                    <label className="font-mono text-[10px] font-black uppercase block mb-1 text-black bg-neon dark:bg-black dark:text-neon w-fit px-1 border-2 border-black">Destination Bank</label>
                    <button
                      type="button"
                      onClick={() => setShowBankDropdown(!showBankDropdown)}
                      className="brutal-input w-full p-3 text-left flex justify-between items-center bg-white! text-black! border-4 border-black group hover:bg-neon/10 transition-colors"
                    >
                      <div className="flex items-center gap-2 overflow-hidden mr-2">
                        {bankDetails.bankCode && <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />}
                        <span className={`truncate uppercase ${bankDetails.bankName ? 'font-black' : 'text-gray-400'}`}>
                          {bankDetails.bankName || 'SEARCH & SELECT BANK'}
                        </span>
                      </div>
                      <ChevronDown className={`w-5 h-5 flex-shrink-0 transition-transform ${showBankDropdown ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showBankDropdown && (
                      <div className="absolute top-full left-0 right-0 z-[100] bg-white border-4 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] mt-2 max-h-64 overflow-y-auto">
                        <div className="sticky top-0 bg-black p-3 border-b-4 border-black z-10">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon" />
                            <input 
                              type="text"
                              value={bankSearch}
                              onChange={(e) => setBankSearch(e.target.value)}
                              placeholder="TYPE BANK NAME..."
                              className="w-full pl-10 pr-3 py-2 text-xs font-black bg-white text-black border-2 border-black focus:outline-none focus:bg-white focus:ring-2 focus:ring-neon"
                              autoFocus
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </div>
                        <div className="bg-white">
                          {filteredInstitutions.length > 0 ? (
                            filteredInstitutions.map((inst) => (
                              <button
                                key={`${inst.institutionCode}-${inst.code}`}
                                type="button"
                                onClick={() => {
                                  const code = inst.institutionCode || inst.code;
                                  console.log('[RampModal] Selected bank:', inst.name, 'Code:', code);
                                  setBankDetails({ ...bankDetails, bankCode: code, bankName: inst.name, accountName: '' });
                                  setShowBankDropdown(false);
                                  setBankSearch('');
                                }}
                                className="w-full text-left p-3 text-xs font-black font-mono hover:bg-neon text-black border-b-2 border-black/10 last:border-0 uppercase"
                              >
                                {inst.name}
                              </button>
                            ))
                          ) : (
                            <div className="p-8 text-center font-mono text-xs text-gray-500 uppercase">
                              No banks match your search
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="font-mono text-[10px] font-black uppercase block mb-1 text-black bg-neon dark:bg-black dark:text-neon w-fit px-1 border-2 border-black">Account Number</label>
                    <div className="relative">
                       <input 
                        type="text" 
                        value={bankDetails.accountNumber}
                        autoComplete="off"
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, '');
                          setBankDetails({...bankDetails, accountNumber: val, accountName: ''});
                          setVerificationError('');
                        }}
                        className="brutal-input p-3 text-xl w-full font-black text-black! bg-white! border-4 border-black placeholder:text-gray-300 focus:bg-white! active:bg-white!" 
                        required
                        maxLength={10}
                        placeholder="0123456789"
                      />
                      {verifying && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          <Loader2 className="w-6 h-6 animate-spin text-black" />
                        </div>
                      )}
                    </div>
                    {verificationError && (
                      <div className="mt-2 bg-red-100 border-2 border-red-500 p-2 text-red-600 text-[10px] font-black uppercase shadow-[2px_2px_0px_0px_rgba(239,68,68,1)] animate-in fade-in slide-in-from-top-1">
                        !! VERIFICATION FAILED: {verificationError}
                      </div>
                    )}
                  </div>

                  {bankDetails.accountName && (
                    <div className="bg-neon p-4 border-4 border-black text-sm flex items-center gap-3 text-black font-black uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] animate-in fade-in slide-in-from-top-2">
                       <div className="bg-white rounded-full p-1 border-2 border-black">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[10px] opacity-70">CONFIRMED ACCOUNT HOLDER:</span>
                        <span>{bankDetails.accountName}</span>
                      </div>
                    </div>
                  )}

                <button 
                  type="submit" 
                  disabled={loading || !bankDetails.accountName}
                  className="brutal-btn mt-4 flex items-center justify-center gap-4 w-full bg-black! text-white!"
                >
                  {loading ? <Loader2 className="animate-spin" /> : 'FINALIZE WITHDRAWAL'}
                </button>
              </form>
            )}

            {step === 3 && order && (
               <div className="text-center py-4">
                 <div className="bg-black text-neon p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-6">
                    <Landmark className="w-10 h-10" />
                 </div>
                 <h3 className="font-oswald text-2xl font-black uppercase mb-4">Transfer Required</h3>
                 <div className="bg-neon/10 border-4 border-black p-4 mb-6 font-mono text-sm text-left">
                    <p className="mb-2 opacity-70 uppercase font-bold text-xs">Send tokens to this address:</p>
                    <div className="flex items-center gap-2 bg-white border-2 border-black p-2 group cursor-pointer" onClick={() => copyToClipboard(order.providerAccount.receiveAddress || '', 'Address')}>
                      <code className="text-[10px] break-all font-bold">{order.providerAccount.receiveAddress}</code>
                      <Copy className="w-4 h-4 shrink-0" />
                    </div>
                    <div className="mt-4 flex justify-between">
                      <span className="text-xs">NETWORK:</span>
                      <span className="text-xs font-bold">BASE</span>
                    </div>
                 </div>
                 <p className="font-mono text-[10px] text-gray-600 mb-8 leading-tight">
                   Once the stablecoins reach this address, Paycrest will settle the NGN to your bank account automatically.
                 </p>
                 <button onClick={onClose} className="brutal-btn w-full">I HAVE SENT TOKENS</button>
               </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
