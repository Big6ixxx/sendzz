'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { BareBrandPage, StatusScreen, statusAction } from '@/components/landing/StatusScreen';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  // No sign-in or wallet hooks here: this screen has to render even when those are what failed.
  return (
    <BareBrandPage>
      <StatusScreen
        eyebrow="Something went wrong"
        title="This page"
        italic="stalled."
        body="Something broke while loading this screen. Trying again usually clears it. If it keeps happening, send us the reference on the right."
        actions={
          <>
            <button type="button" onClick={reset} className={statusAction.primary}>
              Try again
            </button>
            <Link href="/" className={statusAction.secondary}>
              Go to the home page
            </Link>
          </>
        }
        slip={{
          heading: 'Error note',
          code: '500',
          stamp: 'Not completed',
          rows: [
            { label: 'Status', value: 'Interrupted' },
            { label: 'Reference', value: error.digest ?? 'None' },
          ],
        }}
      />
    </BareBrandPage>
  );
}
