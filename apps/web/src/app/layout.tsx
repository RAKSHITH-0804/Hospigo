import type { ReactNode } from 'react';
import { IBM_Plex_Sans } from 'next/font/google';
import { AuthGuard } from '@/lib/auth-guard';
import { cn } from '@/lib/utils';
import './globals.css';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Hospigo',
    template: '%s | Hospigo',
  },
  description: 'Hospital operations',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', ibmPlexSans.variable)}>
      <body>
        <AuthGuard>{children}</AuthGuard>
      </body>
    </html>
  );
}
