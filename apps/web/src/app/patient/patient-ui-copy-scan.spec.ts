/**
 * @jest-environment node
 *
 * Fails if patient App Router .tsx files (non-spec) contain sentence-like
 * user-visible string literals. Copy must come from sessionConfig.
 * Allowed product-name literal: Hospigo.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const PATIENT_ROOT = __dirname;

const ALLOWED_LITERALS = new Set(['Hospigo']);

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (name.endsWith('.tsx') && !name.endsWith('.spec.tsx')) {
      files.push(full);
    }
  }
  return files;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Sentence-like: whitespace, ellipsis ending, or a capitalised multi-character UI phrase. */
function isSentenceLike(raw: string): boolean {
  const text = raw.trim();
  if (text.length < 2) {
    return false;
  }
  if (ALLOWED_LITERALS.has(text)) {
    return false;
  }
  if (/\s/.test(text)) {
    return true;
  }
  if (/[.…]$/.test(text)) {
    return true;
  }
  // Short Title Case / Sentence case labels (Send code already has space; Verify / Resend…)
  if (/^[A-Z][A-Za-z].*[a-z]/.test(text) && text.length >= 4) {
    return true;
  }
  return false;
}

function collectHits(source: string, rel: string): string[] {
  const hits: string[] = [];
  const cleaned = stripComments(source);

  // JSX text nodes only (letters/digits/punctuation that reads as copy — not `) : (` code).
  const jsxText = />\s*([A-Za-z0-9][^<{}\n]*?)\s*</g;
  let match: RegExpExecArray | null;
  while ((match = jsxText.exec(cleaned)) !== null) {
    const text = match[1]?.trim() ?? '';
    if (text && isSentenceLike(text)) {
      hits.push(`${rel}: JSX text "${text}"`);
    }
  }

  const attrs = /\b(?:aria-label|title|alt|placeholder)=(?:\{\s*)?["']([^"']+)["'](?:\s*\})?/g;
  while ((match = attrs.exec(cleaned)) !== null) {
    const text = match[1]?.trim() ?? '';
    if (text && isSentenceLike(text)) {
      hits.push(`${rel}: attr "${text}"`);
    }
  }

  // Ternary / conditional UI string branches: ? 'Label' : 'Other'
  const ternary = /\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
  while ((match = ternary.exec(cleaned)) !== null) {
    for (const part of [match[1], match[2]]) {
      const text = part?.trim() ?? '';
      if (text && isSentenceLike(text)) {
        hits.push(`${rel}: ternary "${text}"`);
      }
    }
  }

  // Standalone JSX expression string: {'Label'} or {"Label"}
  const expr = /\{\s*['"]([^'"]+)['"]\s*\}/g;
  while ((match = expr.exec(cleaned)) !== null) {
    const text = match[1]?.trim() ?? '';
    if (text && isSentenceLike(text)) {
      hits.push(`${rel}: expr "${text}"`);
    }
  }

  return hits;
}

describe('patient UI copy scan', () => {
  it('forbids sentence-like string literals outside sessionConfig (Hospigo allowed)', () => {
    const offenders: string[] = [];
    for (const file of walk(PATIENT_ROOT)) {
      const source = readFileSync(file, 'utf8');
      const rel = relative(PATIENT_ROOT, file).replace(/\\/g, '/');
      offenders.push(...collectHits(source, rel));
    }
    expect(offenders).toEqual([]);
  });
});
