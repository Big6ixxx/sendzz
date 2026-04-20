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
  title: 'SENDZZ // DECT. NETWORK',
  description: 'Uncompromising cross-chain finance.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${oswald.variable} ${jetbrains.variable}`}>
      <body className="antialiased min-h-screen border-12 border-black dark:border-white p-4 lg:p-8 flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
