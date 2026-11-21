/** Undo and redo for an edited value (the layout of a template). Pure: every call returns a new history. */
export type History<T> = { past: T[]; present: T; future: T[] };

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * A new present. An identical value changes nothing (so a click that moved nothing is not a step).
 * Making a change clears what could be redone, as in a word processor. The oldest steps fall off
 * after `limit`.
 */
export function commit<T>(history: History<T>, next: T, limit: number): History<T> {
  if (JSON.stringify(next) === JSON.stringify(history.present)) {
    return history;
  }
  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) {
    return history;
  }
  return { past: [...history.past, history.present], present: next, future: rest };
}

export const canUndo = <T>(history: History<T>): boolean => history.past.length > 0;
export const canRedo = <T>(history: History<T>): boolean => history.future.length > 0;
