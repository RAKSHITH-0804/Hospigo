import { printDesignerConfig as C } from '@/config/print';
import { parseZoom, zoomPctFor } from './zoom';

const a5 = { widthMm: 148, heightMm: 210 };
const a4 = { widthMm: 210, heightMm: 297 };
const pageWidthPx = (p: { widthMm: number }) => p.widthMm * C.pxPerMm + C.rulerPx;

describe('parseZoom', () => {
  it('reads the fit choices and percents, and falls back to the usual zoom', () => {
    expect(parseZoom('fit-width')).toBe('fit-width');
    expect(parseZoom('fit-page')).toBe('fit-page');
    expect(parseZoom('75')).toBe(75);
    for (const junk of ['', 'abc', '-5', '0', 'NaN']) {
      expect({ junk, got: parseZoom(junk) }).toEqual({ junk, got: C.zoomDefaultPct });
    }
  });
});

describe('zoomPctFor', () => {
  it('a fixed percent is exactly as chosen, whatever the room', () => {
    expect(zoomPctFor(125, 200, 200, a5)).toBe(125);
    expect(zoomPctFor(50, 5000, 5000, a4)).toBe(50);
  });

  it('is the usual zoom until the room is known', () => {
    expect(zoomPctFor('fit-width', 0, 0, a5)).toBe(C.zoomDefaultPct);
    expect(zoomPctFor('fit-page', -1, 600, a5)).toBe(C.zoomDefaultPct);
  });

  it('fit width makes the page as wide as the room, on a phone, a laptop and a huge display', () => {
    for (const room of [360, 768, 1280, 1920, 2560]) {
      const pct = zoomPctFor('fit-width', room, 10_000, a4);
      const drawn = (pageWidthPx(a4) * pct) / 100;
      expect({ room, fits: drawn <= room - C.fitMarginPx + 1 }).toEqual({ room, fits: true });
      // and it is not far smaller than the room (one percent step at most), unless clamped
      if (pct > C.fitMinPct && pct < C.fitMaxPct) {
        expect(drawn).toBeGreaterThan(room - C.fitMarginPx - pageWidthPx(a4) / 100 - 1);
      }
    }
  });

  it('fit page also keeps the whole page inside the height there is', () => {
    const wide = zoomPctFor('fit-width', 2000, 700, a4);
    const whole = zoomPctFor('fit-page', 2000, 700, a4);
    expect(whole).toBeLessThan(wide);
    const heightPx = a4.heightMm * C.pxPerMm + C.rulerPx;
    expect((heightPx * whole) / 100).toBeLessThanOrEqual(700 - C.fitMarginPx + 1);
    // a tall room makes no difference: the width decides
    expect(zoomPctFor('fit-page', 800, 5000, a4)).toBe(zoomPctFor('fit-width', 800, 5000, a4));
    // an unknown height falls back to the width
    expect(zoomPctFor('fit-page', 800, 0, a4)).toBe(zoomPctFor('fit-width', 800, 0, a4));
  });

  it('stays between the smallest and the largest fit', () => {
    expect(zoomPctFor('fit-width', 30, 30, a4)).toBe(C.fitMinPct);
    expect(zoomPctFor('fit-width', 100_000, 100_000, { widthMm: 20, heightMm: 20 })).toBe(
      C.fitMaxPct,
    );
  });

  it('a wider page gets a smaller zoom in the same room', () => {
    expect(zoomPctFor('fit-width', 1000, 5000, a4)).toBeLessThan(
      zoomPctFor('fit-width', 1000, 5000, a5),
    );
  });
});
