'use client';
import React, { useState, useEffect } from 'react';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WithdrawModal({ isOpen, onClose }: WithdrawModalProps) {
  const [amount, setAmount] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [nairaEstimate, setNairaEstimate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false); // Success State
  
  const FX_RATE = 1650; 

  useEffect(() => {
    setNairaEstimate(Number(amount) * FX_RATE);
  }, [amount]);

  if (!isOpen) return null;

  const handleWithdraw = async () => {
    if (!amount || !bankAccount || !bankName || !accountName) {
      alert('Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, bankAccount, bankName, accountName }),
      });

      const data = await response.json();

      if (data.success) {
        setIsSuccess(true); // Trigger success view
      } else {
        alert(`❌ Error: ${data.error}`);
      }
    } catch (err) {
      alert('Failed to connect to the server.');
    } finally {
      setLoading(false);
    }
  };

  // SUCCESS VIEW
  if (isSuccess) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-[40px] p-10 max-w-md w-full text-center shadow-2xl animate-in zoom-in-95">
          <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">
            ✓
          </div>
          <h2 className="text-3xl font-black italic text-slate-900 mb-2 tracking-tighter uppercase">Payout Sent!</h2>
          <p className="text-slate-500 mb-8 font-medium">Your ₦{nairaEstimate.toLocaleString()} is being processed by the banking rails.</p>
          
          <div className="bg-slate-50 p-4 rounded-2xl mb-8 border border-slate-100">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Transaction Ref</p>
            <p className="text-xs font-mono text-blue-600 font-bold">SENDZZ-{Math.floor(Math.random() * 1000000)}</p>
          </div>

          <button 
            onClick={() => { setIsSuccess(false); onClose(); window.location.reload(); }}
            className="w-full bg-blue-600 text-white font-black py-5 rounded-2xl shadow-xl hover:bg-blue-700 transition-all"
          >
            DONE
          </button>
        </div>
      </div>
    );
  }

  // INPUT VIEW
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-black text-blue-600 italic tracking-tighter uppercase leading-none">Withdraw</h2>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 transition-colors text-3xl">&times;</button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">USDC</label>
              <input
                type="number"
                placeholder="0.00"
                className="w-full bg-transparent font-bold text-lg outline-none text-black"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
              <label className="block text-[10px] font-bold text-blue-400 uppercase mb-1">NGN (EST.)</label>
              <div className="text-lg font-bold text-blue-600">
                ₦{nairaEstimate.toLocaleString()}
              </div>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <input
              type="text" placeholder="Bank Name"
              className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black text-sm font-medium"
              value={bankName} onChange={(e) => setBankName(e.target.value)}
            />
            <input
              type="text" placeholder="Account Holder Name"
              className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black text-sm font-medium"
              value={accountName} onChange={(e) => setAccountName(e.target.value)}
            />
            <input
              type="text" placeholder="Account Number"
              className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none text-black text-sm font-medium"
              value={bankAccount} onChange={(e) => setBankAccount(e.target.value)}
            />
          </div>

          <button
            disabled={loading}
            onClick={handleWithdraw}
            className={`w-full ${
              loading ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-100'
            } font-black py-5 rounded-[20px] transition-all active:scale-95 mt-4 uppercase tracking-widest`}
          >
            {loading ? 'Processing...' : 'Withdraw to Bank'}
          </button>
        </div>
      </div>
    </div>
  );
}
