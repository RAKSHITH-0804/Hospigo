import type { ReactNode } from 'react';

/** Small SVG charts drawn from theme tokens only (no chart library, no fixed colours). */

const W = 100;
const H = 40;

export function BarChart({
  values,
  labels,
  label,
}: {
  values: number[];
  labels: string[];
  label: string;
}) {
  const max = Math.max(1, ...values);
  const step = W / Math.max(1, values.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart-svg"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {values.map((v, i) => {
        const h = (v / max) * (H - 2);
        return (
          <rect
            key={labels[i] ?? i}
            x={i * step + step * 0.15}
            y={H - h}
            width={step * 0.7}
            height={h}
            className="chart-bar"
          >
            <title>{`${labels[i]}: ${v}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function LineChart({
  values,
  labels,
  label,
}: {
  values: number[];
  labels: string[];
  label: string;
}) {
  const max = Math.max(1, ...values);
  const step = W / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${i * step},${H - 2 - (v / max) * (H - 6)}`);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart-svg"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline points={pts.join(' ')} className="chart-line" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => (
        <circle key={labels[i] ?? i} cx={i * step} cy={H - 2 - (v / max) * (H - 6)} r="0.9">
          <title>{`${labels[i]}: ${v}`}</title>
        </circle>
      ))}
    </svg>
  );
}

const SLICE_CLASSES = ['chart-s1', 'chart-s2', 'chart-s3', 'chart-s4', 'chart-s5'];

export function Donut({
  slices,
  label,
  centre,
}: {
  slices: Array<{ name: string; value: number }>;
  label: string;
  centre?: ReactNode;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 15.9155;
  let offset = 25;
  return (
    <svg viewBox="0 0 42 42" className="chart-donut" role="img" aria-label={label}>
      <circle cx="21" cy="21" r={R} className="chart-track" fill="none" />
      {slices.map((s, i) => {
        const part = (s.value / total) * 100;
        const el = (
          <circle
            key={s.name}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            className={SLICE_CLASSES[i % SLICE_CLASSES.length]}
            strokeDasharray={`${part} ${100 - part}`}
            strokeDashoffset={offset}
          >
            <title>{s.name}</title>
          </circle>
        );
        offset -= part;
        return el;
      })}
      {centre}
    </svg>
  );
}

export const sliceClass = (i: number) => SLICE_CLASSES[i % SLICE_CLASSES.length]!;
