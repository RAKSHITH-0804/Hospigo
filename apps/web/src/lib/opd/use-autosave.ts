'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveResult = { ok: true } | { ok: false; code: string };

export type SaveState = {
  phase: 'idle' | 'saving' | 'saved' | 'error';
  savedAt: Date | null;
  errorCode: string | null;
};

/** How many times an automatic save is tried again (each after the normal delay). */
export const AUTOSAVE_MAX_RETRIES = 3;

/**
 * Saves a draft a few seconds after the last change, so a doctor who forgets to click Save loses
 * nothing. `revision` goes up on every edit. Saves never overlap: one runs at a time, and an edit
 * made while it runs is picked up by the next one. `flush()` (used by Complete) cancels the wait,
 * lets a running save finish and saves anything still unsaved; it answers whether all is saved.
 */
export function useAutosave({
  enabled,
  delayMs,
  revision,
  save,
}: {
  enabled: boolean;
  delayMs: number;
  revision: number;
  save: () => Promise<SaveResult>;
}) {
  const [state, setState] = useState<SaveState>({ phase: 'idle', savedAt: null, errorCode: null });
  const [savedRevision, setSavedRevision] = useState(revision);
  const revisionRef = useRef(revision);
  const savedRevisionRef = useRef(revision);
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef<Promise<boolean> | null>(null);
  const retriesRef = useRef(0);
  const enabledRef = useRef(enabled);
  revisionRef.current = revision;
  saveRef.current = save;
  enabledRef.current = enabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** One save attempt for the revision that exists NOW. Resolves true when it was stored. */
  const runOnce = useCallback((): Promise<boolean> => {
    if (runningRef.current) {
      return runningRef.current;
    }
    const sent = revisionRef.current;
    setState((s) => ({ ...s, phase: 'saving', errorCode: null }));
    const promise = (async () => {
      let result: SaveResult;
      try {
        result = await saveRef.current();
      } catch {
        result = { ok: false, code: 'UNAVAILABLE' };
      }
      runningRef.current = null;
      if (result.ok) {
        retriesRef.current = 0;
        savedRevisionRef.current = sent;
        setSavedRevision(sent);
        setState({ phase: 'saved', savedAt: new Date(), errorCode: null });
        return true;
      }
      setState((s) => ({ ...s, phase: 'error', errorCode: result.code }));
      return false;
    })();
    runningRef.current = promise;
    return promise;
  }, []);

  // Wait `delayMs` after the last change, then save. A change while saving schedules the next one.
  useEffect(() => {
    if (!enabled || revision === savedRevisionRef.current) {
      return;
    }
    clearTimer();
    retriesRef.current = 0;
    timerRef.current = setTimeout(function fire() {
      timerRef.current = null;
      if (!enabledRef.current) {
        return;
      }
      void runOnce().then((ok) => {
        if (ok) {
          if (revisionRef.current !== savedRevisionRef.current) {
            timerRef.current = setTimeout(fire, delayMs);
          }
        } else if (retriesRef.current < AUTOSAVE_MAX_RETRIES) {
          retriesRef.current += 1;
          timerRef.current = setTimeout(fire, delayMs);
        }
      });
    }, delayMs);
    return clearTimer;
  }, [revision, enabled, delayMs, clearTimer, runOnce]);

  useEffect(() => clearTimer, [clearTimer]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (runningRef.current) {
      await runningRef.current;
    }
    if (revisionRef.current === savedRevisionRef.current) {
      return true;
    }
    return runOnce();
  }, [clearTimer, runOnce]);

  const unsaved = revision !== savedRevision;
  return { state, flush, saveNow: flush, unsaved };
}
