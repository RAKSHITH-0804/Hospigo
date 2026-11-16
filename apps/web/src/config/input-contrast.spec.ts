/**
 * @jest-environment node
 *
 * Asserts --input-border vs white surface meets WCAG 3:1 for UI components.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/** Approximate OKLCH (greys / low chroma) → sRGB 0–1 via OKLab. */
function oklchToSrgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, bl].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

function channelLum(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLum) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('input border contrast', () => {
  it('keeps --input-border at least 3:1 against the white card surface', () => {
    const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
    const match = css.match(/--input-border:\s*oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
    expect(match).toBeTruthy();
    const L = Number(match![1]);
    const C = Number(match![2]);
    const h = Number(match![3]);
    const borderLum = relativeLuminance(oklchToSrgb(L, C, h));
    const surfaceLum = 1; // oklch(1 0 0)
    const ratio = contrastRatio(surfaceLum, borderLum);
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
