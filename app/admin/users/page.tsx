'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

import { getAdminUsers } from '@/lib/supabase/admin';
import { cn } from '@/lib/utils';
import { Avatar, EmptyState, PageHeader, Pagination, Panel, RowsShimmer, SearchField, Shimmer, StatTile, usd } from '../components/ui';

const ITEMS_PER_PAGE = 20;

type AdminUserRow = Awaited<ReturnType<typeof getAdminUsers>>[number];

/** `?q=…&page=…` for a given view, omitting defaults so a clean view has a clean URL. */
function viewParams(searchTerm: string, page: number): string {
  const p = new URLSearchParams();
  if (searchTerm) p.set('q', searchTerm);
  if (page > 1) p.set('page', String(page));
  return p.toString();
}

/** Spend tiers, by lifetime volume. */
function tierOf(volume: number): { label: string; className: string } | null {
  if (volume >= 10000) return { label: 'Whale', className: 'bg-[var(--lp-ink)] text-[var(--lp-green)]' };
  if (volume >= 1000) return { label: 'Power', className: 'bg-[#00e87a]/15 text-[#0e7a45]' };
  return null;
}

const joined = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortAddress = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'No wallet');


// `useSearchParams` needs a Suspense boundary to prerender, so the view lives in a child.
export default function UserDirectoryPage() {
  return (
    <Suspense fallback={<Shimmer className="h-96 w-full rounded-[32px]" />}>
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
  const [currentPage, setCurrentPage] = useState(() => Number(searchParams.get('page')) || 1);

  // Mirror the view back into the URL. Debounced and `replace`d so typing a search doesn't
  // push a history entry per keystroke — back should leave the directory, not un-type a word.
  useEffect(() => {
    const qs = viewParams(searchTerm, currentPage);
    const next = qs ? `${pathname}?${qs}` : pathname;
    if (next === `${pathname}${window.location.search}`) return;
    const timer = setTimeout(() => router.replace(next, { scroll: false }), 250);
    return () => clearTimeout(timer);
  }, [searchTerm, currentPage, pathname, router]);

  const { data: users, isPending } = useQuery({
    queryKey: ['admin-users', adminUser?.email?.address],
    queryFn: async () => {
      if (!adminUser?.email?.address) return [];
      return getAdminUsers((await getAccessToken()) ?? undefined);
    },
    enabled: !!adminUser?.email?.address,
  });

  const filteredUsers = useMemo(() => {
    if (!users) return [];
    const q = searchTerm.toLowerCase();
    return users.filter(
      (user) =>
        user.email.toLowerCase().includes(q) ||
        user.id.toLowerCase().includes(q) ||
        user.smart_account_address?.toLowerCase().includes(q),
    );
  }, [users, searchTerm]);

  const summary = useMemo(() => {
    let volume = 0;
    let whales = 0;
    let power = 0;
    for (const u of filteredUsers) {
      const v = u.total_volume || 0;
      volume += v;
      if (v >= 10000) whales++;
      else if (v >= 1000) power++;
    }
    return { volume, whales, power };
  }, [filteredUsers]);

  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE);
  // Clamped: a restored `?page=` can outrun the list if rows were removed (or the search is
  // narrower than when the link was made), and an unclamped page renders as an empty table.
  const safePage = Math.min(Math.max(currentPage, 1), Math.max(totalPages, 1));
  const currentUsers = filteredUsers.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };

  /** Open a user, carrying the current view along so their page can link straight back to it. */
  const openUser = (userId: string) => {
    const qs = viewParams(searchTerm, safePage);
    router.push(`/admin/users/${userId}${qs ? `?${qs}` : ''}`);
  };

  const rowProps = (id: string) => ({
    onClick: () => openUser(id),
    role: 'link' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openUser(id);
      }
    },
  });

  return (
    <div className="space-y-5 md:space-y-8">
      <PageHeader eyebrow="Users" title="The people" italic="behind the volume." />

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <StatTile label="Users" value={filteredUsers.length.toLocaleString('en-US')} loading={isPending} hint={searchTerm ? 'Matching your search' : 'All accounts'} />
        <StatTile label="Combined volume" value={usd(summary.volume, 0)} loading={isPending} hint="Lifetime, settled" />
        <StatTile label="Whales" value={summary.whales.toLocaleString('en-US')} loading={isPending} hint="$10,000+ moved" />
        <StatTile label="Power users" value={summary.power.toLocaleString('en-US')} loading={isPending} tone="text-[#0e7a45]" hint="$1,000+ moved" />
      </div>

      <SearchField
        value={searchTerm}
        onChange={(v) => {
          setSearchTerm(v);
          setCurrentPage(1);
        }}
        placeholder="Search email, ID or wallet"
      />

      <Panel className="overflow-hidden">
        {isPending ? (
          <RowsShimmer rows={8} />
        ) : currentUsers.length === 0 ? (
          <EmptyState icon={<Search className="size-5" />} title="Nobody" italic="matches that." body="Check the spelling, or search by user ID or wallet address instead." />
        ) : (
          <>
            {/* Phones and tablets: one card per person. */}
            <ul className="divide-y divide-[#ece6da] lg:hidden">
              {currentUsers.map((user) => (
                <UserCard key={user.id} user={user} {...rowProps(user.id)} />
              ))}
            </ul>

            {/* Desktop: the full breakdown as a table. */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[1040px] border-collapse text-left">
                <thead>
                  <tr className="lp-mono border-b border-[#e3dcce] text-[12px] uppercase text-[var(--lp-muted)]">
                    <th className="px-6 py-4 font-normal">Person</th>
                    <th className="px-3 py-4 text-right font-normal">Deposits</th>
                    <th className="px-3 py-4 text-right font-normal">Sent</th>
                    <th className="px-3 py-4 text-right font-normal">Received</th>
                    <th className="px-3 py-4 text-right font-normal">Withdrawn</th>
                    <th className="px-3 py-4 text-right font-normal">Bridged</th>
                    <th className="px-3 py-4 text-right font-normal">Total volume</th>
                    <th className="px-6 py-4 text-right font-normal">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ece6da]">
                  {currentUsers.map((user) => {
                    const tier = tierOf(user.total_volume || 0);
                    return (
                      <tr
                        key={user.id}
                        {...rowProps(user.id)}
                        className="group cursor-pointer transition-colors hover:bg-[#fbf9f4] focus:bg-[#fbf9f4] focus:outline-none"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <Avatar email={user.email} />
                            <div className="min-w-0">
                              <p className="max-w-[260px] truncate text-[15px] font-semibold group-hover:text-[#00a857]">{user.email}</p>
                              <p className="lp-mono text-[12px] text-[var(--lp-muted)]">
                                {user.id.slice(0, 8)} · {shortAddress(user.smart_account_address)}
                              </p>
                            </div>
                          </div>
                        </td>
                        {[user.total_deposits, user.total_sent, user.total_received, user.total_withdrawals, user.total_bridge].map((v, i) => (
                          <td key={i} className={cn('px-3 py-4 text-right text-[14px] tabular-nums', v ? 'text-[var(--lp-body)]' : 'text-[rgba(91,100,93,0.6)]')}>
                            {usd(v || 0)}
                          </td>
                        ))}
                        <td className="px-3 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {tier && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tier.className)}>{tier.label}</span>}
                            <span className="lp-display text-[17px] tracking-[-0.02em] tabular-nums">{usd(user.total_volume || 0)}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-[14px] text-[var(--lp-muted)]">{joined(user.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!isPending && filteredUsers.length > 0 && (
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onChange={handlePageChange}
            summary={
              <>
                Showing {currentUsers.length} of {filteredUsers.length.toLocaleString('en-US')} users
              </>
            }
          />
        )}
      </Panel>
    </div>
  );
}

function UserCard({ user, ...props }: { user: AdminUserRow } & React.HTMLAttributes<HTMLLIElement>) {
  const tier = tierOf(user.total_volume || 0);
  const parts = [
    { label: 'Deposits', value: user.total_deposits },
    { label: 'Sent', value: user.total_sent },
    { label: 'Received', value: user.total_received },
    { label: 'Withdrawn', value: user.total_withdrawals },
  ];
  return (
    <li {...props} className="cursor-pointer space-y-3 px-5 py-4 transition-colors hover:bg-[#fbf9f4] focus:bg-[#fbf9f4] focus:outline-none">
      <div className="flex items-center gap-3">
        <Avatar email={user.email} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{user.email}</p>
          <p className="text-[13px] text-[var(--lp-muted)]">Joined {joined(user.created_at)}</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-[var(--lp-muted)]" />
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-[18px] bg-[var(--lp-cream)] px-4 py-3">
        <span className="flex items-center gap-2 text-[13px] text-[var(--lp-muted)]">
          Total volume
          {tier && <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tier.className)}>{tier.label}</span>}
        </span>
        <span className="lp-display text-[20px] tracking-[-0.02em] tabular-nums">{usd(user.total_volume || 0)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-1 sm:grid-cols-4">
        {parts.map((p) => (
          <div key={p.label} className="flex items-baseline justify-between gap-2 sm:block">
            <dt className="text-[12px] text-[var(--lp-muted)]">{p.label}</dt>
            <dd className="text-[13px] tabular-nums">{usd(p.value || 0)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}
