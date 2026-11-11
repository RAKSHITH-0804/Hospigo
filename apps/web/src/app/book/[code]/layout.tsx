import type { ReactNode } from 'react';

export default function BookLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-4 text-sm font-medium">
        Public booking
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
