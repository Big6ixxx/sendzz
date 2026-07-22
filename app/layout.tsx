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
  metadataBase: new URL('https://sendzz.com'),
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
    url: 'https://sendzz.com',
    siteName: 'Sendzz',
    title: 'Sendzz | Money Without Borders',
    description: 'Free, instant, global payments for everyone. Send and receive money without borders using secure, gas-free technology.',
    images: [
      {
        url: '/logo.svg',
        width: 1200,
        height: 630,
        alt: 'Sendzz - Money Without Borders',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sendzz | Money Without Borders',
    description: 'Free, instant, global payments for everyone. Send and receive money without borders using secure, gas-free technology.',
    images: ['/logo.svg'],
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
        <link rel="apple-touch-icon" href="/pwa-icon-192.png" />
      </head>
      <body className="antialiased min-h-screen bg-background text-foreground flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
