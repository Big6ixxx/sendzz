'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SendzzSettings() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState<'EVM' | 'STELLAR' | 'BANK'>('EVM');
  const [details, setDetails] = useState({ stellarAddr: '', bankAcct: '', bankName: '' });

  const handleUpdateIntent = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/update-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          preferredNetwork: intent, 
          payoutDetails: details 
        }),
      });
      if (res.ok) alert(`Success! Your Sendzz Intent is now set to ${intent}.`);
    } catch (err) {
      alert("Failed to update settings.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] p-4 md:p-12 text-black">
      <div className="max-w-xl mx-auto">
        <button onClick={() => router.push('/')} className="mb-6 text-sm font-bold text-blue-600">← Back to Dashboard</button>
        
        <div className="bg-white rounded-[32px] p-10 shadow-sm border border-slate-200">
          <h1 className="text-3xl font-black italic text-blue-600 mb-2">SENDZZ SETTINGS</h1>
          <p className="text-slate-500 mb-10 font-medium">Configure your Universal Payout Intent</p>

          <div className="space-y-8">
            {/* INTENT SELECTOR */}
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 block">Payout Destination</label>
              <div className="grid grid-cols-3 gap-3">
                {['EVM', 'STELLAR', 'BANK'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setIntent(type as any)}
                    className={`py-3 rounded-xl font-bold text-sm transition-all ${intent === type ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* CONDITIONAL INPUTS */}
            {intent === 'STELLAR' && (
              <div className="animate-in fade-in slide-in-from-top-2">
                <label className="text-xs font-bold text-slate-500 block mb-2">Stellar (LOBSTR) Public Key</label>
                <input 
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="G..."
                  value={details.stellarAddr}
                  onChange={(e) => setDetails({...details, stellarAddr: e.target.value})}
                />
              </div>
            )}

            {intent === 'BANK' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-2">Bank Name</label>
                  <input 
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. GTBank"
                    value={details.bankName}
                    onChange={(e) => setDetails({...details, bankName: e.target.value})}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 block mb-2">Account Number</label>
                  <input 
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="0123456789"
                    value={details.bankAcct}
                    onChange={(e) => setDetails({...details, bankAcct: e.target.value})}
                  />
                </div>
              </div>
            )}

            <button 
              onClick={handleUpdateIntent}
              disabled={loading}
              className="w-full bg-slate-900 text-white font-black py-5 rounded-2xl hover:bg-black transition-all shadow-xl active:scale-95"
            >
              {loading ? 'SAVING...' : 'UPDATE SENDZZ INTENT'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}