'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

interface BalanceVisibilityContextType {
  hideBalance: boolean;
  toggleBalanceVisibility: () => void;
  setHideBalance: (value: boolean) => void;
}

const BalanceVisibilityContext = createContext<BalanceVisibilityContextType | undefined>(
  undefined
);

export function BalanceVisibilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [hideBalance, setHideBalanceState] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('hideBalance');
    if (stored === 'true') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHideBalanceState(true);
    }
    setIsInitialized(true);
  }, []);

  const setHideBalance = (value: boolean) => {
    setHideBalanceState(value);
    localStorage.setItem('hideBalance', String(value));
  };

  const toggleBalanceVisibility = () => {
    setHideBalance(!hideBalance);
  };

  return (
    <BalanceVisibilityContext.Provider
      value={{
        hideBalance: isInitialized ? hideBalance : false,
        toggleBalanceVisibility,
        setHideBalance,
      }}
    >
      {children}
    </BalanceVisibilityContext.Provider>
  );
}

export function useBalanceVisibility() {
  const context = useContext(BalanceVisibilityContext);
  if (context === undefined) {
    throw new Error(
      'useBalanceVisibility must be used within a BalanceVisibilityProvider'
    );
  }
  return context;
}
