'use client';

import { useBalanceVisibility } from '@/components/providers/BalanceVisibilityProvider';
import { motion, useSpring, useTransform } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

interface AnimatedBalanceProps {
  balance: string;
  isLoading: boolean;
  className?: string;
}

export function AnimatedBalance({
  balance,
  isLoading,
  className = '',
}: AnimatedBalanceProps) {
  const { hideBalance } = useBalanceVisibility();

  // Convert string balance to number, handling commas if any
  const numericBalance = parseFloat(balance.replace(/,/g, '')) || 0;

  // Find out how many decimal places are in the original string
  const parts = balance.split('.');
  const decimals = parts.length > 1 ? parts[1].length : 2;
  const fractionDigits = Math.max(2, decimals);

  // Track the last confirmed (non-loading) balance
  const lastConfirmedRef = useRef<number>(0);
  // Whether this is the very first load (no balance yet) — use ref to avoid setState-in-effect
  const isFirstLoadRef = useRef(true);
  // Whether we're in a refetch (not the initial load)
  const isRefetchRef = useRef(false);
  // Mirror isFirstLoad into state purely so the component re-renders after first data arrives
  const [hasLoaded, setHasLoaded] = useState(false);

  const spring = useSpring(0, {
    mass: 0.8,
    stiffness: 75,
    damping: 15,
  });

  useEffect(() => {
    if (!isLoading) {
      if (isFirstLoadRef.current) {
        // Initial load: count up from 0 to balance
        isFirstLoadRef.current = false;
        isRefetchRef.current = false;
        spring.jump(0);
        spring.set(numericBalance);
        setTimeout(() => setHasLoaded(true), 0);
      } else {
        // Subsequent loads: only animate if balance changed
        if (numericBalance !== lastConfirmedRef.current) {
          // Count from previous balance to new one
          spring.jump(lastConfirmedRef.current);
          spring.set(numericBalance);
        }
        // If unchanged, spring stays at its current value — no animation
      }
      lastConfirmedRef.current = numericBalance;
      isRefetchRef.current = false;
    } else {
      // Loading: mark as refetch if we've already had a first load
      if (!isFirstLoadRef.current) {
        isRefetchRef.current = true;
      }
      // Do NOT jump to 0 — leave spring at its last confirmed value
    }
  }, [numericBalance, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const display = useTransform(spring, (current) => {
    return current.toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  });

  // Hidden — show dots
  if (hideBalance) {
    return <span className={className}>••••</span>;
  }

  // Initial load skeleton
  if (isLoading && !hasLoaded) {
    return (
      <span className={`opacity-20 blur-[2px] animate-pulse ${className}`}>
        {Number(0).toLocaleString('en-US', {
          minimumFractionDigits: fractionDigits,
          maximumFractionDigits: fractionDigits,
        })}
      </span>
    );
  }

  // Refetch (not first load) — show last value with a subtle pulse
  return (
    <motion.span
      className={className}
      animate={isLoading && hasLoaded ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
      transition={
        isLoading && hasLoaded
          ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.2 }
      }
    >
      {display}
    </motion.span>
  );
}
