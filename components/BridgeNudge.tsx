'use client';

import { useCrossChainBalances } from '@/hooks/useCrossChainBalances';
import { SMART_BRIDGE_CHAINS } from '@/lib/circle/gateway';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

export function BridgeNudge({ smartAddress }: { smartAddress: string }) {
  const { data: allBridges } = useCrossChainBalances(smartAddress);
  const bridges = allBridges?.filter(b => SMART_BRIDGE_CHAINS.includes(b.chain));
  const hasFundsElsewhere = bridges && bridges.length > 0;

  return (
    <AnimatePresence>
      {hasFundsElsewhere && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <Link 
            href="/dashboard/bridge"
            className="block group mt-6"
          >
            <div className="card-glass p-4 border-accent/20 bg-accent/[0.03] flex items-center justify-between group-hover:border-accent/40 transition-all">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-accent animate-pulse" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-accent/60">Liquidity Detected</p>
                  <p className="text-xs font-bold text-white group-hover:text-accent transition-colors">
                    You have USDC on other chains. Bridge them to Base for free.
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-accent group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
