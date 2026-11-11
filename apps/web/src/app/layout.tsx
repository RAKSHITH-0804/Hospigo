import type { ReactNode } from 'react';
import { Geist } from 'next/font/google';
import { AuthGuard } from '@/lib/auth-guard';
import { cn } from '@/lib/utils';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata = {
  title: 'Hospigo',
  description: 'Hospital operations',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
