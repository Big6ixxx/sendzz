'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PublicPage } from '@/components/landing/PublicPage';
import { StatusScreen, statusAction } from '@/components/landing/StatusScreen';

export default function NotFound() {
  const pathname = usePathname();
  return (
    <PublicPage>
      <StatusScreen
        eyebrow="Page not found"
        title="Nothing at this"
        italic="address."
        body="The link may be old, or a letter may have slipped in the URL. Your account and your money are where you left them."
        actions={
          <>
            <Link href="/" className={statusAction.primary}>
              Go to the home page
            </Link>
            <button type="button" onClick={() => window.history.back()} className={statusAction.secondary}>
              Go back
            </button>
          </>
        }
        slip={{
          heading: 'Delivery note',
          code: '404',
          stamp: 'Returned to sender',
          rows: [
            { label: 'Address', value: pathname || '/' },
            { label: 'Status', value: 'No page here' },
          ],
        }}
      />
    </PublicPage>
  );
}
