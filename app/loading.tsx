'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

export default function Loading() {
  return (
    <div className="min-h-screen bg-brand-primary flex flex-col items-center justify-center overflow-hidden relative">
      {/* Ambient background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
          style={{
            background: 'radial-gradient(circle, #00e87a 0%, transparent 70%)',
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-12">
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            duration: 0.8,
            ease: [0.16, 1, 0.3, 1],
          }}
          className="relative"
        >
          {/* Pulsing ring */}
          <div className="absolute inset-0 rounded-full blur-2xl bg-accent/20 scale-150 animate-pulse" />
          
          <div className="relative w-24 h-24 rounded-3xl flex items-center justify-center card-glass p-0 overflow-hidden border-accent/20">
            <Image 
              src="/logo.svg" 
              alt="Sendzz" 
              width={48} 
              height={48} 
              className="animate-pulse"
              priority
            />
            {/* Spinning accent border */}
            <div className="absolute inset-0 border-2 border-transparent border-t-accent rounded-3xl animate-spin" style={{ animationDuration: '2s' }} />
          </div>
        </motion.div>

        <div className="flex flex-col items-center gap-4">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="font-display text-2xl font-bold tracking-tight text-brand-secondary">
              Syncing <span className="text-accent">Sendzz</span>
            </h2>
          </motion.div>
          
          <div className="flex items-center gap-2">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{
                  repeat: Infinity,
                  duration: 1.5,
                  delay: i * 0.2,
                }}
                className="w-2 h-2 rounded-full bg-accent"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
