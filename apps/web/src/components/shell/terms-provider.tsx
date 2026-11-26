'use client';

import type { ReactNode } from 'react';
import { setClientTerms, type Terms } from '@/lib/terminology/terms-core';

/**
 * Hands the hospital's words to the browser side of the copy accessor. They are set while this renders,
 * before the screens below it read any text (the same words the server used for the first paint).
 */
export function TermsProvider({ terms, children }: { terms: Terms; children: ReactNode }) {
  setClientTerms(terms);
  return <>{children}</>;
}
