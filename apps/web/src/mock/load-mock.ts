/**
 * LABEL: tiny async mock loader so concept screens can exercise loading / empty / error.
 */

export type MockLoadMode = 'ok' | 'empty' | 'error';

export type LoadMockOptions = {
  mode?: MockLoadMode;
  delayMs?: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function loadMockData<T>(
  data: T,
  emptyValue: T,
  options: LoadMockOptions = {},
): Promise<T> {
  await wait(options.delayMs ?? 40);
  const mode = options.mode ?? 'ok';
  if (mode === 'error') {
    throw new Error('Sample data could not be loaded');
  }
  if (mode === 'empty') {
    return emptyValue;
  }
  return data;
}
