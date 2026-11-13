'use client';

import { useCallback, useEffect, useState } from 'react';
import { loadMockData, type LoadMockOptions, type MockLoadMode } from '@/mock/load-mock';

export type MockPhase = 'loading' | 'ready' | 'empty' | 'error';

export function useMockLoad<T>(
  data: T,
  emptyValue: T,
  isEmpty: (value: T) => boolean,
  options: LoadMockOptions = {},
) {
  const mode: MockLoadMode = options.mode ?? 'ok';
  const delayMs = options.delayMs ?? 40;
  const [phase, setPhase] = useState<MockPhase>('loading');
  const [value, setValue] = useState<T>(emptyValue);

  const reload = useCallback(() => {
    setPhase('loading');
    loadMockData(data, emptyValue, { mode, delayMs })
      .then((next) => {
        if (isEmpty(next)) {
          setValue(emptyValue);
          setPhase('empty');
          return;
        }
        setValue(next);
        setPhase('ready');
      })
      .catch(() => {
        setPhase('error');
      });
  }, [data, delayMs, emptyValue, isEmpty, mode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { phase, value, reload };
}
