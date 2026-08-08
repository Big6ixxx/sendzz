'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Award,
  ChevronLeft,
  ChevronRight,
  Crown,
  Search,
  Wallet
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { getAdminUsers } from '@/lib/supabase/admin';

const ITEMS_PER_PAGE = 20;

/** `?q=…&page=…` for a given view, omitting defaults so a clean view has a clean URL. */
function viewParams(searchTerm: string, page: number): string {
  const p = new URLSearchParams();
  if (searchTerm) p.set('q', searchTerm);
  if (page > 1) p.set('page', String(page));
  return p.toString();
}

// `useSearchParams` needs a Suspense boundary to prerender, so the view lives in a child.
export default function UserDirectoryPage() {
  return (
    <Suspense fallback={<div className="h-96 rounded-3xl bg-white/2 animate-pulse" />}>
      <UserDirectory />
    </Suspense>
  );
}

function UserDirectory() {
  const { user: adminUser, getAccessToken } = usePrivy();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Seeded from the URL so returning here — by back link, browser back, refresh, or a shared
  // link — restores the exact view rather than dumping you on page 1 of an unfiltered list.
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') ?? '');
  const [currentPage, setCurrentPage] = useState(
    () => Number(searchParams.get('page')) || 1,
  );

  // Mirror the view back into the URL. Debounced and `replace`d so typing a search doesn't
  // push a history entry per keystroke — back should leave the directory, not un-type a word.
  useEffect(() => {
    const qs = viewParams(searchTerm, currentPage);
    const next = qs ? `${pathname}?${qs}` : pathname;
    if (next === `${pathname}${window.location.search}`) return;
    const timer = setTimeout(() => router.replace(next, { scroll: false }), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, currentPage, pathname, router]);

  const { data: users, isLoading } = useQuery({
    queryKey: ['admin-users', adminUser?.email?.address],
    queryFn: async () => {
      if (!adminUser?.email?.address) return [];
      return getAdminUsers((await getAccessToken()) ?? undefined);
    },
    enabled: !!adminUser?.email?.address,
  });

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    return users.filter(
      (user) =>
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.smart_account_address
          ?.toLowerCase()
          .includes(searchTerm.toLowerCase()),
    );
  }, [users, searchTerm]);

  // Pagination logic
  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  // Clamped: a restored `?page=` can outrun the list if rows were removed (or the search is
  // narrower than when the link was made), and an unclamped page renders as an empty table.
  const safePage = Math.min(Math.max(currentPage, 1), Math.max(totalPages, 1));
  const currentUsers = filteredUsers.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  );

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  /** Open a user, carrying the current view along so their page can link straight back to it. */
  const openUser = (userId: string) => {
    const qs = viewParams(searchTerm, safePage);
    router.push(`/admin/users/${userId}${qs ? `?${qs}` : ''}`);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">
            User Directory
          </h1>
          <p className="text-white/40 mt-1 font-medium">
            Complete platform participant metrics.
          </p>
        </div>

        {/* Search */}
        <div className="relative group w-full md:w-96">
          <div className="absolute inset-0 bg-blue-400/5 rounded-2xl blur-xl group-hover:bg-blue-400/10 transition-all" />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20 group-focus-within:text-blue-400 transition-colors" />
          <input
            type="text"
            placeholder="Search by email, ID, or wallet..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 pl-12 pr-4 text-white placeholder:text-white/20 focus:outline-none focus:ring-2 focus:ring-blue-400/20 focus:border-blue-400/40 transition-all text-sm font-medium relative z-10"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="card-glass overflow-hidden border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1200px]">
            <thead>
              <tr className="border-b border-white/5 bg-white/2">
                <th className="px-6 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] w-[200px]">
                  User Profile
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em]">
                  Smart Address
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-accent/60 uppercase tracking-[0.2em] text-center">
                  Deposits
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-blue-400/60 uppercase tracking-[0.2em] text-center">
                  Sent
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-purple-400/60 uppercase tracking-[0.2em] text-center">
                  Received
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-red-400/60 uppercase tracking-[0.2em] text-center">
                  Withdrawals
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-purple-500/60 uppercase tracking-[0.2em] text-center">
                  Bridges
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] text-right">
                  Total Vol
                </th>
                <th className="px-6 py-5 text-[10px] font-bold text-white/30 uppercase tracking-[0.2em] text-right">
                  Joined
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <AnimatePresence mode="popLayout">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td colSpan={9} className="px-6 py-8">
                        <div className="h-4 bg-white/5 rounded w-full" />
                      </td>
                    </tr>
                  ))
                ) : currentUsers.length > 0 ? (
                  currentUsers.map((user, i) => (
                    <motion.tr
                      key={user.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => openUser(user.id)}
                      role="link"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openUser(user.id);
                        }
                      }}
                      className="group hover:bg-white/2 transition-colors cursor-pointer focus:outline-none focus:bg-white/3"
                    >
                      <td className="px-6 py-6">
                        <div className="flex items-center gap-4">
                          <div className="w-9 h-9 rounded-full bg-linear-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-xs font-bold text-white/60">
                            {user.email.charAt(0).toUpperCase()}
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors truncate">
                              {user.email}
                            </p>
                            <p className="text-[10px] font-medium text-white/20 uppercase tracking-wider tabular-nums truncate">
                              ID: {user.id.slice(0, 8)}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-6">
                        <div className="flex items-center gap-2 group/wallet cursor-pointer">
                          <Wallet className="w-3 h-3 text-white/20 group-hover/wallet:text-accent transition-colors" />
                          <code className="text-[10px] text-white/40 group-hover/wallet:text-white transition-colors tabular-nums">
                            {user.smart_account_address
                              ? `${user.smart_account_address.slice(0, 6)}...${user.smart_account_address.slice(-4)}`
                              : 'None'}
                          </code>
                        </div>
                      </td>

                      {/* Deposits */}
                      <td className="px-6 py-6 text-center">
                        <p className="text-xs font-bold text-accent tabular-nums">
                          $
                          {(user.total_deposits || 0).toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                        </p>
                      </td>

                      {/* Sent */}
                      <td className="px-6 py-6 text-center">
                        <p className="text-xs font-bold text-blue-400 tabular-nums">
                          $
                          {(user.total_sent || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </p>
                      </td>

                      {/* Received */}
                      <td className="px-6 py-6 text-center">
                        <p className="text-xs font-bold text-purple-400 tabular-nums">
                          $
                          {(user.total_received || 0).toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                        </p>
                      </td>

                      <td className="px-6 py-6 text-center">
                        <p className="text-xs font-bold text-red-400 tabular-nums">
                          $
                          {(user.total_withdrawals || 0).toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                        </p>
                      </td>

                      {/* Bridges */}
                      <td className="px-6 py-6 text-center">
                        <p className="text-xs font-bold text-purple-500 tabular-nums">
                          $
                          {(user.total_bridge || 0).toLocaleString(
                            undefined,
                            {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            },
                          )}
                        </p>
                      </td>

                      {/* Total Volume */}
                      <td className="px-6 py-6 text-right">
                        <div className="flex flex-col items-end gap-1">
                          <p className="text-sm font-black text-white tabular-nums">
                            $
                            {(user.total_volume || 0).toLocaleString(
                              undefined,
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              },
                            )}
                          </p>
                          {user.total_volume >= 10000 ? (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 text-[8px] font-black uppercase tracking-widest">
                              <Crown className="w-2.5 h-2.5" /> Whale
                            </span>
                          ) : user.total_volume >= 1000 ? (
                            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[8px] font-black uppercase tracking-widest">
                              <Award className="w-2.5 h-2.5" /> Power
                            </span>
                          ) : null}
                        </div>
                      </td>

                      {/* Join Date */}
                      <td className="px-6 py-6 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[10px] font-bold text-white/40">
                            {new Date(user.created_at).toLocaleDateString(
                              undefined,
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              },
                            )}
                          </span>
                          <span className="text-[8px] font-medium text-white/10 uppercase tracking-widest">
                            Verified
                          </span>
                        </div>
                      </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-4 text-white/20">
                        <Search className="w-12 h-12" />
                        <p className="font-medium">
                          No users found matching your search.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-5 border-t border-white/5 bg-white/1 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs font-medium text-white/30">
            Showing{' '}
            <span className="text-white/60 font-bold">
              {currentUsers.length}
            </span>{' '}
            of{' '}
            <span className="text-white/60 font-bold">
              {filteredUsers.length}
            </span>{' '}
            users
          </p>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePageChange(safePage - 1)}
              disabled={safePage === 1}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white disabled:opacity-50 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-1 mx-2">
              <span className="text-xs font-bold text-white/60">Page</span>
              <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-400/10 border border-blue-400/20 text-blue-400 text-xs font-bold">
                {safePage}
              </span>
              <span className="text-xs font-bold text-white/60">
                of {totalPages || 1}
              </span>
            </div>
            <button
              onClick={() => handlePageChange(safePage + 1)}
              disabled={safePage === totalPages || totalPages === 0}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-white/40 hover:text-white disabled:opacity-50 transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
