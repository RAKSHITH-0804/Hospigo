/**
 * Step 2.1g: the hospital's own words, applied inside the central copy accessor. `staffCopy` is wrapped
 * (see config/staff-copy.ts): every string read from it first asks which words the current hospital
 * prefers for the 24 terms and swaps the standard word of each term for the hospital's word (keeping
 * capital letters). With no words set (the usual case) nothing changes and nothing is slower.
 *
 * Where the words come from: on the server the layout puts them in a per-request store (registered
 * by terms-server.ts); in the browser they are one value for the signed-in hospital.
 */
export type Terms = Record<string, string>;

let serverReader: (() => Terms | undefined) | null = null;
let clientTerms: Terms = {};

/** Registered once by the server module (it owns the per-request store). */
export const setTermsReader = (reader: () => Terms | undefined): void => {
  serverReader = reader;
};
/** The browser's words (set by the provider in the app layout; also used by tests). */
export const setClientTerms = (terms: Terms): void => {
  clientTerms = terms;
};
export const currentTerms = (): Terms => serverReader?.() ?? clientTerms;

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Rule = { re: RegExp; word: string };
const ruleCache = new Map<string, Rule[]>();

/** Longest standard word first, so "Patients" is swapped before "Patient". */
function rulesFor(defaults: Terms, terms: Terms): Rule[] {
  const cacheKey = JSON.stringify(terms);
  const hit = ruleCache.get(cacheKey);
  if (hit) {
    return hit;
  }
  const rules = Object.keys(terms)
    .filter((key) => defaults[key] && terms[key]?.trim())
    .sort((a, b) => defaults[b]!.length - defaults[a]!.length)
    .map((key) => ({
      re: new RegExp(`\\b${escapeRe(defaults[key]!)}\\b`, 'gi'),
      word: terms[key]!.trim(),
    }));
  if (ruleCache.size > 100) {
    ruleCache.clear();
  }
  ruleCache.set(cacheKey, rules);
  return rules;
}

/** The hospital's word in the same capital style as the standard word it replaces. */
function inStyle(found: string, word: string): string {
  if (found === found.toUpperCase() && found.length > 1) {
    return word.toUpperCase();
  }
  if (found[0] === found[0]!.toLowerCase()) {
    return word[0]!.toLowerCase() + word.slice(1);
  }
  return word[0]!.toUpperCase() + word.slice(1);
}

export function translate(text: string, defaults: Terms): string {
  const terms = currentTerms();
  if (!text || Object.keys(terms).length === 0) {
    return text;
  }
  let out = text;
  for (const rule of rulesFor(defaults, terms)) {
    out = out.replace(rule.re, (found) => inStyle(found, rule.word));
  }
  return out;
}

/** Wraps a copy object: every string read from it (at any depth) goes through translate(). */
export function withTerms<T extends object>(base: T, defaults: Terms): T {
  const wrapped = new WeakMap<object, object>();
  const wrap = (value: object): object => {
    const have = wrapped.get(value);
    if (have) {
      return have;
    }
    const proxy = new Proxy(value, {
      get(target, prop, receiver) {
        const out = Reflect.get(target, prop, receiver) as unknown;
        if (typeof out === 'string') {
          return translate(out, defaults);
        }
        if (typeof out === 'object' && out !== null) {
          return wrap(out);
        }
        return out;
      },
    });
    wrapped.set(value, proxy);
    return proxy;
  };
  return wrap(base) as T;
}
