import { canRedo, canUndo, commit, redo, startHistory, undo } from './history';

describe('history', () => {
  it('records steps and goes back and forth through them', () => {
    let h = startHistory({ n: 0 });
    h = commit(h, { n: 1 }, 10);
    h = commit(h, { n: 2 }, 10);
    expect(h.present).toEqual({ n: 2 });
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(h.present).toEqual({ n: 1 });
    h = undo(h);
    expect(h.present).toEqual({ n: 0 });
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    expect(h.present).toEqual({ n: 2 });
    expect(canRedo(h)).toBe(false);
  });

  it('undo and redo at the ends change nothing', () => {
    const h = startHistory('a');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('a change that changes nothing is not a step', () => {
    const h = startHistory({ a: [1, 2] });
    expect(commit(h, { a: [1, 2] }, 10)).toBe(h);
  });

  it('a new change clears what could be redone', () => {
    let h = commit(commit(startHistory(0), 1, 10), 2, 10);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, 5, 10);
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([0, 1]);
  });

  it('the oldest steps fall off after the limit', () => {
    let h = startHistory(0);
    for (let i = 1; i <= 5; i += 1) {
      h = commit(h, i, 3);
    }
    expect(h.past).toEqual([2, 3, 4]);
    expect(h.present).toBe(5);
  });
});
