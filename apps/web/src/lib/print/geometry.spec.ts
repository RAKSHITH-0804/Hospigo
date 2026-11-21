import {
  clampBox,
  handleCursor,
  HANDLES,
  moveBox,
  nudgeBox,
  resizeBox,
  round1,
  snap,
  type Box,
  type Page,
} from './geometry';

const page: Page = { widthMm: 148, heightMm: 210 };
const box: Box = { xMm: 20, yMm: 30, widthMm: 50, heightMm: 10 };

describe('snap and round', () => {
  it('snaps to the nearest grid line, or only rounds to one decimal without a grid', () => {
    expect(snap(12.4, 5)).toBe(10);
    expect(snap(12.6, 5)).toBe(15);
    expect(snap(12.4, 1)).toBe(12);
    expect(snap(12.46, 0)).toBe(12.5);
    expect(snap(0.1 + 0.2, 0)).toBe(0.3);
    expect(round1(10.25)).toBe(10.3);
  });
});

describe('clampBox', () => {
  it('keeps a box on the page and at least its minimum size', () => {
    expect(clampBox({ xMm: -5, yMm: -5, widthMm: 50, heightMm: 10 }, page, 1, 1)).toEqual({
      xMm: 0,
      yMm: 0,
      widthMm: 50,
      heightMm: 10,
    });
    expect(clampBox({ xMm: 140, yMm: 205, widthMm: 50, heightMm: 10 }, page, 1, 1)).toEqual({
      xMm: 98,
      yMm: 200,
      widthMm: 50,
      heightMm: 10,
    });
    expect(clampBox({ xMm: 0, yMm: 0, widthMm: 0.2, heightMm: 0 }, page, 1, 1)).toMatchObject({
      widthMm: 1,
      heightMm: 1,
    });
    // a box wider than the page shrinks to the page
    expect(clampBox({ xMm: 10, yMm: 0, widthMm: 500, heightMm: 10 }, page, 1, 1)).toMatchObject({
      xMm: 0,
      widthMm: 148,
    });
  });
});

describe('moveBox', () => {
  it('moves by the distance and snaps the new place to the grid', () => {
    expect(moveBox(box, 10.4, 5.6, page, 1)).toMatchObject({ xMm: 30, yMm: 36 });
    expect(moveBox(box, 10.4, 5.6, page, 5)).toMatchObject({ xMm: 30, yMm: 35 });
    expect(moveBox(box, 10.44, 5.66, page, 0)).toMatchObject({ xMm: 30.4, yMm: 35.7 });
  });

  it('never leaves the page and never changes the size', () => {
    expect(moveBox(box, -500, -500, page, 1)).toEqual({ ...box, xMm: 0, yMm: 0 });
    expect(moveBox(box, 500, 500, page, 1)).toEqual({ ...box, xMm: 98, yMm: 200 });
  });
});

describe('nudgeBox', () => {
  it('moves by exact steps (no snapping) and stops at the edge', () => {
    expect(nudgeBox(box, 0.1, 0, page)).toMatchObject({ xMm: 20.1, yMm: 30 });
    expect(nudgeBox({ ...box, xMm: 0 }, -5, 0, page).xMm).toBe(0);
    expect(nudgeBox(box, 0, 5, page).yMm).toBe(35);
  });
});

describe('resizeBox', () => {
  const resize = (handle: Parameters<typeof resizeBox>[1], dx: number, dy: number, grid = 1) =>
    resizeBox(box, handle, dx, dy, page, grid, 1, 1);

  it('the east and south handles move the right and bottom edges only', () => {
    expect(resize('e', 10, 99)).toEqual({ ...box, widthMm: 60 });
    expect(resize('s', 99, 5)).toEqual({ ...box, heightMm: 15 });
    expect(resize('se', 10, 5)).toEqual({ ...box, widthMm: 60, heightMm: 15 });
  });

  it('the west and north handles move the left and top edges and keep the far edges still', () => {
    expect(resize('w', -10, 0)).toEqual({ ...box, xMm: 10, widthMm: 60 });
    expect(resize('n', 0, -10)).toEqual({ ...box, yMm: 20, heightMm: 20 });
    expect(resize('nw', 5, 5)).toEqual({ xMm: 25, yMm: 35, widthMm: 45, heightMm: 5 });
    // the right edge was at 70 and the bottom edge at 40: still there
    const r = resize('nw', -7, -3);
    expect(r.xMm + r.widthMm).toBe(70);
    expect(r.yMm + r.heightMm).toBe(40);
  });

  it('edges snap to the grid', () => {
    // the right edge was at 70; 80.4 snaps to the grid line at 80
    expect(resize('e', 10.4, 0, 5)).toEqual({ ...box, widthMm: 60 });
  });

  it('a box cannot get smaller than the minimum: the dragged edge stops', () => {
    const e = resize('e', -100, 0);
    expect(e).toMatchObject({ xMm: 20, widthMm: 1 });
    const w = resize('w', 100, 0);
    expect(w.widthMm).toBe(1);
    expect(w.xMm + w.widthMm).toBe(70); // the right edge did not move
    const n = resize('n', 0, 100);
    expect(n.heightMm).toBe(1);
    expect(n.yMm + n.heightMm).toBe(40);
  });

  it('a thin line can be resized down to its own minimum', () => {
    const line: Box = { xMm: 10, yMm: 10, widthMm: 100, heightMm: 0.3 };
    expect(resizeBox(line, 's', 0, -5, page, 0, 1, 0.1).heightMm).toBe(0.1);
  });

  it('a box never grows past the page', () => {
    expect(resize('e', 500, 0)).toMatchObject({ xMm: 20, widthMm: 128 });
    expect(resize('w', -500, 0)).toMatchObject({ xMm: 0, widthMm: 70 });
    expect(resize('s', 0, 500)).toMatchObject({ yMm: 30, heightMm: 180 });
    expect(resize('n', 0, -500)).toMatchObject({ yMm: 0, heightMm: 40 });
  });

  it('knows a cursor for every handle', () => {
    expect(HANDLES).toHaveLength(8);
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('se')).toBe('nwse-resize');
  });
});
