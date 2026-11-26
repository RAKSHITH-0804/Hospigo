import { terminologyConfig } from '@/config/terminology';
import { callStaffApi } from '@/lib/auth/staff-api';

type Entry = { at: number; items: Record<string, string> };
const cache = new Map<string, Entry>();

/**
 * The words the signed-in hospital prefers (Indigo sets them). Kept for a short time per signed-in
 * person's hospital so a page load is not slowed by one more call; a failed call means "no overrides",
 * so the words of the copy file are used. Call it once per page load, on the server.
 */
export async function hospitalTerms(cacheKey: string): Promise<Record<string, string>> {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < terminologyConfig.cacheSeconds * 1000) {
    return hit.items;
  }
  let items: Record<string, string> = {};
  try {
    const result = await callStaffApi<{ items?: Record<string, string> }>('/terminology', {
      method: 'GET',
    });
    items = result.ok && result.data.items ? result.data.items : {};
  } catch {
    // no session context or the API is down: the standard words are used
    return {};
  }
  if (cache.size >= terminologyConfig.cacheMaxEntries) {
    cache.clear();
  }
  cache.set(cacheKey, { at: now, items });
  return items;
}

/** The hospital's word for a key, or the standard word. */
export const termOr = (terms: Record<string, string>, key: string, standard: string): string =>
  terms[key]?.trim() || standard;

/** For tests: forget everything that was kept. */
export const clearTermsCacheForTests = (): void => cache.clear();
