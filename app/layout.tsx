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
  title: 'Sendzz | Money Without Borders',
  description: 'Instant, gas-sponsored global payments for everyone.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${oswald.variable} ${jetbrains.variable}`}>
      <body className="antialiased min-h-screen bg-background text-foreground flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

