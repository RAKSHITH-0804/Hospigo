import { readFileSync } from 'fs';
import { join } from 'path';

const SRC_ROOT = __dirname;
const GLOBALS = join(SRC_ROOT, 'app', 'globals.css');

const PAGE_WRAPPER_SELECTORS = [
  '.viewport-fill',
  '.booking-page',
  '.booking-body',
  '.booking-card',
  '.booking-card-grid',
  '.login-page',
  '.shell-root',
  '.shell-main',
];

const LAYOUT_SOURCES = [
  join(SRC_ROOT, 'app', 'layout.tsx'),
  join(SRC_ROOT, 'app', 'login', 'layout.tsx'),
  join(SRC_ROOT, 'app', 'book', '[code]', 'layout.tsx'),
  join(SRC_ROOT, 'app', 'admin', 'layout.tsx'),
  join(SRC_ROOT, 'app', 'app', 'layout.tsx'),
  join(SRC_ROOT, 'components', 'brand-scope.tsx'),
  join(SRC_ROOT, 'components', 'shell', 'app-shell.tsx'),
  join(SRC_ROOT, 'components', 'book', 'booking-screen.tsx'),
  join(SRC_ROOT, 'app', 'login', 'page.tsx'),
];

function extractRuleBody(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}(?![\\w-])\\s*\\{([^}]*)\\}`, 'm'));
  return match?.[1] ?? null;
}

describe('scroll-lock guard', () => {
  it('keeps viewport height as min-height only on page wrappers', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    const offenders: string[] = [];

    const htmlBody = css.match(/html\s*\{[^}]*\}[\s\S]*?body\s*\{[^}]*\}/);
    const rootBlock = htmlBody?.[0] ?? '';
    if (/overflow\s*:\s*hidden/.test(rootBlock)) {
      offenders.push('html/body: overflow: hidden');
    }
    if (/height\s*:\s*100(dvh|vh|%)/.test(rootBlock)) {
      offenders.push('html/body: fixed 100% height');
    }

    for (const selector of PAGE_WRAPPER_SELECTORS) {
      const body = extractRuleBody(css, selector);
      if (!body) {
        continue;
      }
      if (/overflow(-x)?\s*:\s*hidden/.test(body)) {
        offenders.push(`${selector}: overflow hidden`);
      }
      if (/(?<!min-|max-)height\s*:\s*var\(--viewport-min-height\)/.test(body)) {
        offenders.push(`${selector}: fixed viewport height`);
      }
      if (/(?<!min-)height\s*:\s*100(dvh|vh)/.test(body)) {
        offenders.push(`${selector}: fixed 100dvh/vh height`);
      }
      if (/max-height\s*:\s*(100(dvh|vh)|var\(--viewport-min-height\))/.test(body)) {
        offenders.push(`${selector}: max-height viewport lock`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('avoids h-screen / overflow-hidden page locks in layout sources', () => {
    const offenders: string[] = [];

    for (const file of LAYOUT_SOURCES) {
      const source = readFileSync(file, 'utf8');
      const rel = file.slice(SRC_ROOT.length + 1).replace(/\\/g, '/');
      if (/\bh-screen\b|\bh-dvh\b|\bmax-h-screen\b|\bmax-h-dvh\b/.test(source)) {
        offenders.push(`${rel}: fixed viewport Tailwind height`);
      }
      if (
        /\boverflow-hidden\b/.test(source) &&
        /viewport-fill|shell-root|booking-page|login-page/.test(source)
      ) {
        offenders.push(`${rel}: overflow-hidden near page wrapper`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
