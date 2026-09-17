'use client';

import { usePrivy } from '@privy-io/react-auth';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const LINKS = [
  { label: 'Features', href: '/features' },
  { label: 'Security', href: '/security' },
];

export function SiteHeader() {
  const { authenticated, login } = usePrivy();
  const router = useRouter();

  const handleAction = () => {
    if (authenticated) router.push('/dashboard');
    else login();
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex justify-between items-center py-5 px-6 md:px-12"
      style={{
        background: 'rgba(7, 7, 10, 0.6)',
        backdropFilter: 'blur(24px) saturate(180%)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <Link href="/" aria-label="Sendzz home">
        <Image src="/logo.svg" alt="Sendzz" width={100} height={30} priority />
      </Link>

      <nav className="hidden md:flex items-center gap-8">
        {LINKS.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className="text-[13px] font-medium text-[rgba(248,248,246,0.45)] hover:text-[#f8f8f6] transition-colors"
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <button
        onClick={handleAction}
        className="btn-accent h-10 px-6 text-sm rounded-full font-semibold"
        style={{ height: '2.5rem' }}
      >
        {authenticated ? 'Dashboard' : 'Get Started'}
      </button>
    </header>
  );
}
