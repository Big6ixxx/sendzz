'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Home } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-brand-primary flex flex-col items-center justify-center overflow-hidden relative p-6">
      {/* Ambient background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-1/4 right-[-10%] w-[500px] h-[500px] rounded-full opacity-10 blur-[100px]"
          style={{
            background: 'radial-gradient(circle, #3b82f6 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute bottom-1/4 left-[-10%] w-[500px] h-[500px] rounded-full opacity-10 blur-[100px]"
          style={{
            background: 'radial-gradient(circle, #00e87a 0%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-10 max-w-xl text-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative"
        >
          <div className="absolute inset-0 rounded-full blur-3xl bg-accent/10 scale-150" />
          <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center card-glass border-white/10 p-0">
            <Image src="/logo.svg" alt="Sendzz" width={48} height={48} />
          </div>
        </motion.div>

        <div className="space-y-4">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-7xl md:text-9xl font-bold tracking-tighter text-brand-secondary/10"
          >
            404
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="space-y-2"
          >
            <h2 className="text-3xl font-display font-bold text-brand-secondary">
              Page Not Found
            </h2>
            <p className="text-brand-secondary/40 font-medium leading-relaxed">
              The address you&apos;re looking for doesn&apos;t exist on our network. 
              Double check the URL or head back to the dashboard.
            </p>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto"
        >
          <Link
            href="/dashboard"
            className="btn-accent h-14 px-8 rounded-2xl flex items-center justify-center gap-3 group"
          >
            <Home className="w-5 h-5" />
            <span className="font-bold uppercase tracking-tight">Dashboard</span>
          </Link>
          <button
            onClick={() => window.history.back()}
            className="h-14 px-8 rounded-2xl flex items-center justify-center gap-3 font-semibold text-brand-secondary/60 border border-white/10 bg-white/5 hover:bg-white/10 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Go Back</span>
          </button>
        </motion.div>
      </div>

      <div className="fixed bottom-12 left-1/2 -translate-x-1/2">
        <p className="text-[10px] font-bold uppercase tracking-[0.4em] text-brand-secondary/10">
          Global Settlement Network
        </p>
      </div>
    </div>
  );
}
