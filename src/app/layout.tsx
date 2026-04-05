import './globals.css';
import type { ReactNode } from 'react';
import { Fraunces, Source_Sans_3 } from 'next/font/google';
import Nav from '@/components/Nav';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display' });
const body = Source_Sans_3({ subsets: ['latin'], variable: '--font-body' });

export const metadata = {
  title: 'Dental Ledger Studio',
  description: 'Deterministic dental billing with explainable balances'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        <Nav />
        <main>{children}</main>
      </body>
    </html>
  );
}
