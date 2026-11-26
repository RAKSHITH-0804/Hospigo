'use client';

import { useEffect } from 'react';

/**
 * Opens the print window once, when the page has shown (the patient card after payment, when the
 * hospital has switched that on). Nothing here decides whether to print: the page only renders this
 * when it should.
 */
export function AutoPrint({ delayMs }: { delayMs: number }) {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);
  return null;
}
