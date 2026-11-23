/**
 * @jest-environment node
 *
 * Fails if new staff UI surfaces contain sentence-like literals.
 * Copy must come from staff-copy.ts / sessionConfig / props.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const WEB_SRC = join(__dirname, '..');
/**
 * EVERY folder under apps/web/src is scanned (Step 7f). A new folder is covered the moment it
 * exists: nothing has to be added here. Only test files and the test helper folder are skipped.
 */
const SCAN_ROOTS = [WEB_SRC];
const SKIPPED_FOLDERS = new Set(['test', 'node_modules']);

const ALLOWED_LITERALS = new Set(['Hospigo', 'HQ', '—']);

function walk(dir: string, files: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    return files;
  }
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIPPED_FOLDERS.has(name)) {
        walk(full, files);
      }
    } else if (name.endsWith('.tsx') && !/\.(spec|test)\.tsx$/.test(name)) {
      files.push(full);
    }
  }
  return files;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isSentenceLike(raw: string): boolean {
  const text = raw.trim();
  if (text.length < 2) return false;
  if (ALLOWED_LITERALS.has(text)) return false;
  // A piece of code that the JSX-text pattern caught between two tags ("0 ? (", "1 || x ? (").
  if (/(\?\s*\(|&&\s*\(|\|\|\s*\(|\)\s*\?|=>|\s=\s|;|\(\s*$)/.test(text)) return false;
  // A list of CSS class names written in kebab-case ("settings-content settings-content-wide").
  if (text.split(/\s+/).every((token) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(token)))
    return false;
  // Tailwind / utility class lists are not UI copy.
  if (/\b(?:bg|text|font|min|rounded|border|flex|grid|px|py|w|h|items|justify)-/.test(text)) {
    return false;
  }
  if (/\s/.test(text)) return true;
  if (/[.…]$/.test(text)) return true;
  if (/^[A-Z][A-Za-z].*[a-z]/.test(text) && text.length >= 4) return true;
  return false;
}

function collectHits(source: string, rel: string): string[] {
  const hits: string[] = [];
  const cleaned = stripComments(source);
  // Exclude `=>` arrow so map callbacks are not treated as JSX text nodes.
  const jsxText = /(?<!=)>\s*([A-Za-z0-9][^<{}\n]*?)\s*</g;
  let match: RegExpExecArray | null;
  while ((match = jsxText.exec(cleaned)) !== null) {
    const text = match[1]?.trim() ?? '';
    if (text && isSentenceLike(text)) hits.push(`${rel}: JSX text "${text}"`);
  }
  const attrs = /\b(?:aria-label|title|alt|placeholder)=(?:\{\s*)?["']([^"']+)["'](?:\s*\})?/g;
  while ((match = attrs.exec(cleaned)) !== null) {
    const text = match[1]?.trim() ?? '';
    if (text && isSentenceLike(text)) hits.push(`${rel}: attr "${text}"`);
  }
  const ternary = /\?\s*['"]([^'"]+)['"]\s*:\s*['"]([^'"]+)['"]/g;
  while ((match = ternary.exec(cleaned)) !== null) {
    for (const part of [match[1], match[2]]) {
      const text = part?.trim() ?? '';
      if (text && isSentenceLike(text)) hits.push(`${rel}: ternary "${text}"`);
    }
  }
  const expr = /\{\s*['"]([^'"]+)['"]\s*\}/g;
  while ((match = expr.exec(cleaned)) !== null) {
    const text = match[1]?.trim() ?? '';
    if (text && isSentenceLike(text)) hits.push(`${rel}: expr "${text}"`);
  }
  return hits;
}

describe('staff UI copy scan', () => {
  it('forbids sentence-like literals in every screen and component under src', () => {
    const offenders: string[] = [];
    const files = SCAN_ROOTS.flatMap((root) => walk(root));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const rel = relative(WEB_SRC, file).replace(/\\/g, '/');
      offenders.push(...collectHits(source, rel));
    }
    expect(offenders).toEqual([]);
  });
});
