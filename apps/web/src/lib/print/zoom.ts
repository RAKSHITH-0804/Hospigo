import { printDesignerConfig as C } from '@/config/print';
import type { Page } from './geometry';

/** How big the page is drawn: to the width of its place, to the whole place, or a fixed percent. */
export type ZoomChoice = 'fit-width' | 'fit-page' | number;

export const ZOOM_FIT_WIDTH = 'fit-width';
export const ZOOM_FIT_PAGE = 'fit-page';

/** The value of a zoom select back to a choice. */
export function parseZoom(value: string): ZoomChoice {
  if (value === ZOOM_FIT_WIDTH || value === ZOOM_FIT_PAGE) {
    return value;
  }
  const pct = Number(value);
  return Number.isFinite(pct) && pct > 0 ? pct : C.zoomDefaultPct;
}

/**
 * The zoom in percent for a choice. A fixed percent is as chosen. "Fit width" makes the page (with
 * its rulers) as wide as the room there is, "fit page" also as tall as the room there is, so the
 * whole page can be seen on any screen from a phone to a very large display. When the room is not
 * known (not measured yet) the usual 100 percent is used. The result stays between the smallest and
 * the largest fit.
 */
export function zoomPctFor(
  choice: ZoomChoice,
  roomWidthPx: number,
  roomHeightPx: number,
  page: Page,
): number {
  if (typeof choice === 'number') {
    return choice;
  }
  if (roomWidthPx <= 0) {
    return C.zoomDefaultPct;
  }
  const pageWidthPx = page.widthMm * C.pxPerMm + C.rulerPx;
  const pageHeightPx = page.heightMm * C.pxPerMm + C.rulerPx;
  let pct = ((roomWidthPx - C.fitMarginPx) / pageWidthPx) * 100;
  if (choice === 'fit-page' && roomHeightPx > 0) {
    pct = Math.min(pct, ((roomHeightPx - C.fitMarginPx) / pageHeightPx) * 100);
  }
  return Math.min(C.fitMaxPct, Math.max(C.fitMinPct, Math.floor(pct)));
}
