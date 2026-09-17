import Image from 'next/image';
import Link from 'next/link';

import { TELEGRAM_URL, X_URL } from '@/lib/social';

const LINKS = [
  { label: 'Security', href: '/security' },
  { label: 'Privacy', href: '/privacy' },
];

/** Shared by the nav links and the social icons, so all five fade identically on hover. */
const FADED = 'text-[rgba(248,248,246,0.3)] hover:text-[#f8f8f6] transition-colors';

export function SiteFooter() {
  return (
    <footer
      className="px-6 md:px-12 py-10"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Sendzz" width={50} height={15} priority />
          <span className="text-[11px] ml-2" style={{ color: 'rgba(248,248,246,0.2)' }}>
            © {new Date().getFullYear()}
          </span>
        </div>

        <div className="flex items-center gap-8">
          {LINKS.map((l) => (
            <Link key={l.label} href={l.href} className={`text-[11px] font-medium ${FADED}`}>
              {l.label}
            </Link>
          ))}

          {/* Their own group so the icons sit together rather than a nav-width gap apart. */}
          <div className="flex items-center gap-4">
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Sendzz on X"
              className={FADED}
            >
              {/* lucide ships neither of these marks, so the paths are inlined. */}
              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Sendzz on Telegram"
              className={FADED}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M21.94 4.3 18.9 19.1c-.23 1.02-.84 1.27-1.7.79l-4.7-3.46-2.27 2.18c-.25.25-.46.46-.95.46l.34-4.8 8.74-7.9c.38-.34-.08-.53-.59-.19l-10.8 6.8-4.65-1.45c-1.01-.32-1.03-1.01.21-1.5l18.17-7c.84-.31 1.58.2 1.3 1.47z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
