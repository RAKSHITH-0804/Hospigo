/**
 * Read `#t=` from the URL fragment and strip the hash from the address bar.
 * Token stays only in memory — never query, storage, or logs.
 *
 * Capture is idempotent for React Strict Mode (dev remount / double effect):
 * the first call reads+clears the hash; later calls on the same path reuse
 * the in-memory result so a cleared fragment is not treated as "no token".
 */

type Held = { path: string; token: string | null };

let held: Held | undefined;

function peekTokenFromHash(): string | null {
  const raw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!raw) {
    return null;
  }
  const params = new URLSearchParams(raw);
  const token = params.get('t')?.trim() ?? '';
  if (!token || token.length < 8) {
    return null;
  }
  return token;
}

function clearHashFromAddressBar(): void {
  const pathAndQuery = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, '', pathAndQuery);
}

/** Test helper: reset module capture between cases. */
export function resetActionTokenHashCaptureForTests(): void {
  held = undefined;
}

export function takeActionTokenFromHash(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const path = window.location.pathname;
  const fromHash = peekTokenFromHash();
  if (fromHash) {
    clearHashFromAddressBar();
    held = { path, token: fromHash };
    return fromHash;
  }
  // Hash empty (already stripped, or never present). Reuse first capture on this path.
  if (held && held.path === path) {
    return held.token;
  }
  clearHashFromAddressBar();
  held = { path, token: null };
  return null;
}
