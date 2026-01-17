'use client';
import React, { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function SendzzLogin() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });

    if (error) {
      setMessage({ type: 'error', text: error.message });
    } else {
      setMessage({ type: 'success', text: '✨ Check your inbox! We sent a magic link to your email.' });
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        
        {/* BRANDING */}
        <div className="text-center mb-8">
          <div className="inline-block bg-blue-600 p-3 rounded-2xl shadow-xl shadow-blue-100 mb-4">
            <span className="text-white font-black text-3xl italic leading-none">S</span>
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-blue-600 italic">SENDZZ</h1>
          <p className="text-slate-400 font-medium mt-2 text-sm uppercase tracking-widest">Universal Email Gateway</p>
        </div>

        {/* LOGIN CARD */}
        <div className="bg-white rounded-[32px] p-10 shadow-sm border border-slate-200">
          <h2 className="text-xl font-bold text-slate-800 mb-2">Welcome Back</h2>
          <p className="text-slate-500 text-sm mb-8">No password needed. Just your email.</p>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
              <input 
                type="email" 
                required
                placeholder="you@example.com"
                className="w-full mt-1 px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-blue-600 outline-none transition-all focus:bg-white"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button 
              disabled={loading}
              className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95 disabled:bg-slate-200 disabled:shadow-none"
            >
              {loading ? 'SENDING LINK...' : 'GET MAGIC LINK'}
            </button>
          </form>

          {message && (
            <div className={`mt-6 p-4 rounded-2xl text-sm font-medium animate-in fade-in slide-in-from-top-2 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
              {message.text}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <p className="text-center mt-8 text-slate-400 text-xs font-medium italic">
          By continuing, you agree to the Sendzz Terms of Service.
        </p>
      </div>
    </main>
  );
}