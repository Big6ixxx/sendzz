'use client';
import React, { useState, useEffect } from 'react';
import TransactionHistory from '../components/TransactionHistory'; // Fixed: Added .. to go up a folder
import WithdrawModal from '../components/WithdrawModal'; // Fixed: Added .. to go up a folder
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

export default function SendzzClaimPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email ?? null);
      } else {
        // If not logged in, redirect to login so they can claim
        router.push('/login');
      }
      setLoading(false);
    };
    checkUser();
  }, [supabase, router]);

  if (loading) return <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center font-bold text-blue-600 animate-pulse italic">SENDZZ: VERIFYING CLAIM...</div>;

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        
        {/* TOP NAV */}
        <nav className="flex justify-between items-center mb-12 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-100">
              <span className="text-white font-black text-xl italic leading-none">S</span>
            </div>
            <h1 className="text-2xl font-black tracking-tighter text-blue-600 italic">SENDZZ</h1>
          </div>
          <div className="text-xs font-bold text-slate-400 bg-slate-50 px-4 py-2 rounded-full border border-slate-100 italic">
            Claimant: {userEmail}
          </div>
        </nav>

        <div className="space-y-8">
          {/* WELCOME CARD */}
          <div className="bg-blue-600 rounded-[32px] p-10 text-white shadow-xl shadow-blue-100 relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-4xl font-black italic mb-2 tracking-tighter">FUNDS RECEIVED! 💸</h2>
              <p className="text-blue-100 font-medium max-w-md">Your USDC is secured in your Sendzz Email Wallet. You can now withdraw it to your bank or a crypto wallet.</p>
              
              <div className="flex gap-4 mt-8">
                <button 
                  onClick={() => setIsWithdrawOpen(true)}
                  className="bg-white text-blue-600 px-8 py-4 rounded-2xl font-black text-sm shadow-lg hover:bg-blue-50 transition-all active:scale-95"
                >
                  WITHDRAW TO BANK
                </button>
              </div>
            </div>
            <div className="absolute -right-10 -bottom-10 opacity-10 text-[200px] font-black italic">S</div>
          </div>

          {/* HISTORY TABLE */}
          <div className="bg-white rounded-[32px] p-8 border border-slate-200 shadow-sm">
            <h3 className="text-lg font-bold mb-6 italic text-slate-400 uppercase tracking-widest">Recent Claim Activity</h3>
            <TransactionHistory />
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