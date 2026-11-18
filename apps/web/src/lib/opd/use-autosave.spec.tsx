import { act, renderHook } from '@testing-library/react';
import { AUTOSAVE_MAX_RETRIES, useAutosave, type SaveResult } from './use-autosave';

const DELAY = 5000;

type Props = { enabled: boolean; revision: number; save: () => Promise<SaveResult> };

function setup(save: () => Promise<SaveResult>, enabled = true) {
  return renderHook((p: Props) => useAutosave({ delayMs: DELAY, ...p }), {
    initialProps: { enabled, revision: 0, save },
  });
}

const ok = async (): Promise<SaveResult> => ({ ok: true });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe('useAutosave', () => {
  it('saves once, only after the delay, and marks the draft saved', async () => {
    const save = jest.fn(ok);
    const { result, rerender } = setup(save);
    rerender({ enabled: true, revision: 1, save });
    expect(result.current.unsaved).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(DELAY - 1);
    });
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe('saved');
    expect(result.current.state.savedAt).toBeInstanceOf(Date);
    expect(result.current.unsaved).toBe(false);
  });

  it('keeps waiting while the doctor keeps typing (one save for a burst of edits)', async () => {
    const save = jest.fn(ok);
    const { rerender } = setup(save);
    for (let revision = 1; revision <= 4; revision += 1) {
      rerender({ enabled: true, revision, save });
      await act(async () => {
        jest.advanceTimersByTime(DELAY - 100);
      });
    }
    expect(save).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never saves when disabled (a completed or not started consultation)', async () => {
    const save = jest.fn(ok);
    const { rerender } = setup(save, false);
    rerender({ enabled: false, revision: 3, save });
    await act(async () => {
      jest.advanceTimersByTime(DELAY * 5);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('an edit made while a save is running is saved by the next save', async () => {
    let release: (r: SaveResult) => void = () => undefined;
    const slow = jest.fn(
      () =>
        new Promise<SaveResult>((resolve) => {
          release = resolve;
        }),
    );
    const { result, rerender } = setup(slow);
    rerender({ enabled: true, revision: 1, save: slow });
    await act(async () => {
      jest.advanceTimersByTime(DELAY);
    });
    expect(slow).toHaveBeenCalledTimes(1);
    rerender({ enabled: true, revision: 2, save: slow });
    await act(async () => {
      release({ ok: true });
    });
    // revision 2 is still unsaved
    expect(result.current.unsaved).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(DELAY);
    });
    expect(slow).toHaveBeenCalledTimes(2);
    await act(async () => {
      release({ ok: true });
    });
    expect(result.current.unsaved).toBe(false);
  });

  it('shows an error, retries a limited number of times and then stops', async () => {
    const failing = jest.fn(async (): Promise<SaveResult> => ({ ok: false, code: 'UNAVAILABLE' }));
    const { result, rerender } = setup(failing);
    rerender({ enabled: true, revision: 1, save: failing });
    // One delay at a time: each retry is scheduled after the failed save has finished.
    for (let i = 0; i < AUTOSAVE_MAX_RETRIES + 4; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(DELAY);
      });
    }
    expect(failing).toHaveBeenCalledTimes(1 + AUTOSAVE_MAX_RETRIES);
    expect(result.current.state).toMatchObject({ phase: 'error', errorCode: 'UNAVAILABLE' });
    expect(result.current.unsaved).toBe(true);
  });

  it('treats a thrown error like a failed save', async () => {
    const boom = jest.fn(async (): Promise<SaveResult> => {
      throw new Error('network');
    });
    const { result, rerender } = setup(boom);
    rerender({ enabled: true, revision: 1, save: boom });
    await act(async () => {
      jest.advanceTimersByTime(DELAY);
    });
    expect(result.current.state.phase).toBe('error');
  });

  it('flush saves at once without waiting and answers true; false when the save fails', async () => {
    const save = jest.fn(ok);
    const { result, rerender } = setup(save);
    rerender({ enabled: true, revision: 1, save });
    let flushed = false;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);

    const failing = jest.fn(async (): Promise<SaveResult> => ({ ok: false, code: 'X' }));
    const second = setup(failing);
    second.rerender({ enabled: true, revision: 1, save: failing });
    await act(async () => {
      flushed = await second.result.current.flush();
    });
    expect(flushed).toBe(false);
  });

  it('flush with nothing unsaved does not call save', async () => {
    const save = jest.fn(ok);
    const { result } = setup(save);
    let flushed = false;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('flush waits for a save already running instead of starting a second one', async () => {
    let release: (r: SaveResult) => void = () => undefined;
    const slow = jest.fn(
      () =>
        new Promise<SaveResult>((resolve) => {
          release = resolve;
        }),
    );
    const { result, rerender } = setup(slow);
    rerender({ enabled: true, revision: 1, save: slow });
    await act(async () => {
      jest.advanceTimersByTime(DELAY);
    });
    let done = false;
    let flushPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      flushPromise = result.current.flush().then((v) => {
        done = v;
        return v;
      });
    });
    expect(done).toBe(false);
    await act(async () => {
      release({ ok: true });
      await flushPromise;
    });
    expect(done).toBe(true);
    expect(slow).toHaveBeenCalledTimes(1);
  });
});
