/**
 * The maths of moving and resizing a box on the page. Pure functions on millimetres: the screen
 * turns mouse pixels into millimetres first. Every result is a box that stays on the page.
 */
export type Box = { xMm: number; yMm: number; widthMm: number; heightMm: number };
export type Page = { widthMm: number; heightMm: number };
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: readonly Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** One decimal: the API takes millimetres with at most one decimal. */
export const round1 = (value: number): number => Math.round(value * 10) / 10;

/** The nearest grid line (a grid of 0 only rounds to one decimal). */
export function snap(value: number, gridMm: number): number {
  return gridMm > 0 ? round1(Math.round(value / gridMm) * gridMm) : round1(value);
}

/** Keeps a box on the page, at least `min` big. */
export function clampBox(box: Box, page: Page, minWidth: number, minHeight: number): Box {
  const widthMm = round1(Math.min(Math.max(box.widthMm, minWidth), page.widthMm));
  const heightMm = round1(Math.min(Math.max(box.heightMm, minHeight), page.heightMm));
  return {
    widthMm,
    heightMm,
    xMm: round1(Math.min(Math.max(box.xMm, 0), page.widthMm - widthMm)),
    yMm: round1(Math.min(Math.max(box.yMm, 0), page.heightMm - heightMm)),
  };
}

/** Moves a box by (dx, dy) millimetres; the new place snaps to the grid and stays on the page. */
export function moveBox(box: Box, dx: number, dy: number, page: Page, gridMm: number): Box {
  return clampBox(
    {
      ...box,
      xMm: snap(box.xMm + dx, gridMm),
      yMm: snap(box.yMm + dy, gridMm),
    },
    page,
    box.widthMm,
    box.heightMm,
  );
}

/** A keyboard nudge: exact steps, no snapping. */
export function nudgeBox(box: Box, dx: number, dy: number, page: Page): Box {
  return clampBox(
    { ...box, xMm: box.xMm + dx, yMm: box.yMm + dy },
    page,
    box.widthMm,
    box.heightMm,
  );
}

/**
 * Drags one handle of a box by (dx, dy). The edges that the handle holds move (and snap to the
 * grid); the opposite edges stay still. A box never gets smaller than `minWidth` x `minHeight`
 * and never leaves the page.
 */
export function resizeBox(
  box: Box,
  handle: Handle,
  dx: number,
  dy: number,
  page: Page,
  gridMm: number,
  minWidth: number,
  minHeight: number,
): Box {
  let left = box.xMm;
  let right = box.xMm + box.widthMm;
  let top = box.yMm;
  let bottom = box.yMm + box.heightMm;
  if (handle.includes('w')) {
    left = snap(left + dx, gridMm);
  }
  if (handle.includes('e')) {
    right = snap(right + dx, gridMm);
  }
  if (handle.includes('n')) {
    top = snap(top + dy, gridMm);
  }
  if (handle.includes('s')) {
    bottom = snap(bottom + dy, gridMm);
  }
  // inside the page
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(page.widthMm, right);
  bottom = Math.min(page.heightMm, bottom);
  // not smaller than the minimum: the edge that is being dragged stops
  if (right - left < minWidth) {
    if (handle.includes('w')) {
      left = right - minWidth;
    } else {
      right = left + minWidth;
    }
  }
  if (bottom - top < minHeight) {
    if (handle.includes('n')) {
      top = bottom - minHeight;
    } else {
      bottom = top + minHeight;
    }
  }
  return clampBox(
    { xMm: left, yMm: top, widthMm: right - left, heightMm: bottom - top },
    page,
    minWidth,
    minHeight,
  );
}

/** The cursor a handle shows. */
export function handleCursor(handle: Handle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    default:
      return 'nwse-resize';
  }
}
