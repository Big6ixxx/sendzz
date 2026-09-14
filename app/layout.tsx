import { Providers } from '@/components/providers';
import type { Metadata } from 'next';
import { JetBrains_Mono, Oswald } from 'next/font/google';
import './globals.css';

const oswald = Oswald({ subsets: ['latin'], variable: '--font-oswald' });
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});
export const metadata: Metadata = {
  metadataBase: new URL('https://sendzz.io'),
  title: {
    default: 'Sendzz | Money Without Borders',
    template: '%s | Sendzz'
  },
  description: 'Free, instant, global payments for everyone. Send and receive money without borders using secure, gas-free technology.',
  keywords: ['payments', 'money transfer', 'global payments', 'borderless', 'fintech', 'secure payments', 'gas-free'],
  authors: [{ name: 'Sendzz Team' }],
  creator: 'Sendzz',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://sendzz.io',
    siteName: 'Sendzz',
    title: 'Sendzz | Money Without Borders',
    description: 'Free, instant, global payments for everyone. Send and receive money without borders using secure, gas-free technology.',
    images: [
      {
        // Square, so the card renders as a logo tile. The dimensions must match the file —
        // claiming 1200x630 for a 512x512 image makes some crawlers reject it outright.
        url: '/Sendz-512.png',
        width: 512,
        height: 512,
        alt: 'Sendzz - Money Without Borders',
      },
    ],
  },
  twitter: {
    // `summary`, not `summary_large_image`: the wide card expects a 1.91:1 image, and feeding
    // it a square one gets letterboxed or silently downgraded anyway.
    card: 'summary',
    title: 'Sendzz | Money Without Borders',
    description: 'Free, instant, global payments for everyone. Send and receive money without borders using secure, gas-free technology.',
    images: ['/Sendz-512.png'],
    creator: '@sendzz',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${oswald.variable} ${jetbrains.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#00e87a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/Sendz-192.png" />
      </head>
      <body className="antialiased min-h-screen bg-background text-foreground flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
