import { Toaster } from '@/components/ui/sonner';
import type { Metadata } from 'next';
import { Geist_Mono, Inter, Syne } from 'next/font/google';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

const syne = Syne({
  variable: '--font-syne',
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Sendzz – Instant Email Payments',
  description:
    'Send USDC to any email address instantly. Withdraw to your bank. No wallet needed.',
  openGraph: {
    title: 'Sendzz – Instant Email Payments',
    description: 'Send USDC to any email address instantly.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${syne.variable} ${geistMono.variable}`}
    >
      <body className="antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
