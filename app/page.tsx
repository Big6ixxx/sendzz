'use client';
import React, { useState, useEffect } from 'react';
import TransactionHistory from './components/TransactionHistory';
import WithdrawModal from './components/WithdrawModal';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function SendzzDashboard() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const checkUser = async () => {
      setAuthChecking(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email ?? null);
      } else {
        setUserEmail(null);
      }
      setAuthChecking(false);
    };
    checkUser();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const handleSend = async () => {
    if (!userEmail) return alert("❌ Session Error: Please login again.");
    setLoading(true);
    try {
      const response = await fetch('/api/send-usdc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount }),
        credentials: 'include', 
      });
      if (response.status === 401) throw new Error("Unauthorized: Your session expired.");
      const data = await response.json();
      if (data.success) {
        alert("💸 Sendzz Successful!");
        window.location.reload();
      } else {
        alert("Error: " + data.error);
      }
    } catch (err: any) {
      alert(err.message || "Connection failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* TOP NAV */}
        <nav className="flex justify-between items-center mb-12 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-100">
              <span className="text-white font-black text-xl italic leading-none">S</span>
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-blue-600">SENDZZ</h1>
          </div>
          
          <div className="flex items-center gap-3">
            {/* WITHDRAW BUTTON - NOW ALWAYS RENDERED BUT DISABLED IF NO AUTH */}
            <button 
                onClick={() => userEmail ? setIsWithdrawOpen(true) : alert("Please login to withdraw")}
                className={`px-4 py-2 rounded-full font-bold text-sm transition-all ${userEmail ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
            >
                Withdraw to Bank
            </button>

            {authChecking ? (
                <div className="h-8 w-20 bg-slate-50 animate-pulse rounded-full"></div>
            ) : userEmail ? (
              <div className="flex items-center gap-3">
                <div className="hidden md:flex flex-col items-end">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Wallet</span>
                    <span className="text-xs font-bold text-blue-600 italic">{userEmail}</span>
                </div>
                <button onClick={handleLogout} className="bg-slate-900 text-white px-5 py-2 rounded-full font-bold text-sm hover:bg-black transition-all">Logout</button>
              </div>
            ) : (
              <button onClick={() => router.push('/login')} className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-100">Login</button>
            )}
          </div>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* LEFT COLUMN: SEND MONEY */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-[32px] p-8 shadow-sm border border-slate-200">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">Send USDC <span className="text-blue-600 italic">📤</span></h2>
              
              {!userEmail && !authChecking ? (
                <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100 text-center">
                    <p className="text-sm font-medium text-blue-800 mb-4">Your session has expired. Please log in to start sending.</p>
                    <button onClick={() => router.push('/login')} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-100">Login to Sendzz</button>
                </div>
              ) : (
                <div className="space-y-4">
                    <div className="group">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Recipient</label>
                        <input 
                            type="email" placeholder="hello@recipient.com"
                            className="w-full mt-1 px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all group-hover:bg-white"
                            value={email} onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>
                    <div className="group">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Amount</label>
                        <div className="relative">
                            <input 
                                type="number" placeholder="0.00"
                                className="w-full mt-1 px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all group-hover:bg-white"
                                value={amount} onChange={(e) => setAmount(e.target.value)}
                            />
                            <span className="absolute right-4 top-5 font-bold text-slate-400 italic">USDC</span>
                        </div>
                    </div>
                    <button 
                        disabled={loading || !userEmail}
                        onClick={handleSend}
                        className={`w-full font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95 flex justify-center items-center gap-2 ${loading || !userEmail ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700'}`}
                    >
                        {loading ? 'Processing...' : 'Send via Sendzz'}
                    </button>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: HISTORY */}
          <div className="lg:col-span-2 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-blue-600 rounded-[32px] p-8 text-white shadow-xl shadow-blue-100 relative overflow-hidden">
                <p className="text-blue-100 text-sm font-medium mb-1 italic opacity-80">Universal Balance</p>
                <h3 className="text-3xl font-black italic underline decoration-blue-300 underline-offset-8">READY TO CLAIM</h3>
                <div className="absolute -right-6 -bottom-6 opacity-10 text-9xl font-black italic">S</div>
              </div>
              <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm flex flex-col justify-center relative overflow-hidden">
                <p className="text-slate-400 text-sm font-medium mb-1 italic">Identity Status</p>
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 italic">
                  <span className={`h-2 w-2 rounded-full ${userEmail ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                  {userEmail ? 'Authenticated' : 'Offline'}
                </h3>
              </div>
            </div>

            <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
              <TransactionHistory />
            </div>
          </div>

        </div>
      </div>

      <WithdrawModal 
        isOpen={isWithdrawOpen} 
        onClose={() => setIsWithdrawOpen(false)} 
      />
    </main>
  );
}