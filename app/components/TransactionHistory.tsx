// src/components/TransactionHistory.tsx
"use client";

import React from 'react';

interface Transaction {
  id: string | number;
  email: string;
  amount: string | number;
  status: string;
  hash: string;
  created_at?: string;
}

interface TransactionHistoryProps {
  transactions?: Transaction[];
}

export default function TransactionHistory({ transactions = [] }: TransactionHistoryProps) {
  return (
    <div className="w-full bg-slate-900/50 backdrop-blur-md p-6 rounded-2xl border border-slate-800 shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-white tracking-tight">Recent Activity</h2>
        <span className="text-xs font-medium text-slate-500 uppercase tracking-widest">Universal Mail Gateway</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
              <th className="pb-4 px-4 font-medium">Recipient Email</th>
              <th className="pb-4 px-4 font-medium">Asset Amount</th>
              <th className="pb-4 px-4 font-medium">Status</th>
              <th className="pb-4 px-4 font-medium text-right">Blockchain</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {transactions.length > 0 ? (
              transactions.map((tx) => (
                <tr key={tx.id} className="group hover:bg-slate-800/20 transition-colors duration-200">
                  <td className="py-4 px-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-slate-200">{tx.email}</span>
                      {tx.created_at && (
                        <span className="text-[10px] text-slate-500">{new Date(tx.created_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span className="text-sm font-bold text-white">{tx.amount} <span className="text-blue-400">USDC</span></span>
                  </td>
                  <td className="py-4 px-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                      <span className="text-xs font-medium text-green-400/90 capitalize">
                        {tx.status || 'Confirmed'}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-4 text-right">
                    <a 
                      href={`https://stellar.expert/explorer/public/tx/${tx.hash}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Explorer
                      <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-12 text-center text-slate-500 text-sm italic">
                  No transactions found yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}