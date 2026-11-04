import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestKind = 'HOSPITAL' | 'HQ';

/**
 * Per-request ambient context. Step 6 will fill the same interface from tokens.
 * Access memoisation lives on this object only (never process-global).
 */
export type RequestContext = {
  tenantId: string | null;
  userId: string | null;
  kind: RequestKind;
  activeBranchId: string | null;
  requestId: string;
  /** Request-scoped AccessService memo (keys are stable strings). */
  accessMemo?: Map<string, unknown>;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error('Request context is required but was not set');
  }
  return ctx;
}
