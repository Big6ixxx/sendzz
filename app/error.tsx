'use client';

import { motion } from 'framer-motion';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import Image from 'next/image';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-brand-primary flex flex-col items-center justify-center overflow-hidden relative p-6">
      {/* Ambient background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-10 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, #f87171 0%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-10 max-w-xl text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative"
        >
          <div className="absolute inset-0 rounded-full blur-3xl bg-red-500/10 scale-150" />
          <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center card-glass border-red-500/20 p-0">
            <Image src="/logo.svg" alt="Sendzz" width={48} height={48} className="grayscale" />
          </div>
        </motion.div>

        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-widest">
              System Fault
            </div>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <h2 className="text-3xl font-display font-bold text-brand-secondary">
              Something went wrong
            </h2>
            <p className="text-brand-secondary/40 font-medium leading-relaxed max-w-sm mx-auto">
              We encountered an unexpected error while processing your request. 
              Our engineers have been notified.
            </p>
          </motion.div>
        </div>

        {error.digest && (
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 font-mono text-[10px] text-brand-secondary/30">
            Error ID: {error.digest}
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="w-full sm:w-auto"
        >
          <button
            onClick={reset}
            className="btn-accent h-14 px-12 rounded-2xl flex items-center justify-center gap-3 w-full sm:w-auto shadow-[0_12px_40px_rgba(0,232,122,0.15)]"
          >
            <RefreshCcw className="w-5 h-5" />
            <span className="font-bold uppercase tracking-tight">Try Again</span>
          </button>
        </motion.div>
      </div>
    </div>
  );
}
