import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Small charts drawn from theme tokens only (no chart library, no fixed colours). The bars and
 * points are real elements that grow with the card (not a stretched picture), and each can be a
 * link: a bar for a day opens the report of that day.
 */

const W = 100;
const H = 40;

function Wrap({ href, title, children }: { href?: string; title: string; children: ReactNode }) {
  return href ? (
    <Link href={href} title={title} className="chart-hit">
      {children}
    </Link>
  ) : (
    <span title={title} className="chart-hit">
      {children}
    </span>
  );
}

export function BarChart({
  values,
  labels,
  label,
  hrefs,
}: {
  values: number[];
  labels: string[];
  label: string;
  /** Where each bar leads (same order as the values); a bar without one is not a link. */
  hrefs?: Array<string | undefined>;
}) {
  const max = Math.max(1, ...values);
  return (
    <div
      className="chart-bars"
      role="img"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
    >
      {values.map((v, i) => (
        <Wrap key={labels[i] ?? i} href={hrefs?.[i]} title={`${labels[i]}: ${v}`}>
          <span className="chart-bar-track">
            <span className="chart-bar-fill" style={{ height: `${(v / max) * 100}%` }} />
          </span>
          <span className="chart-bar-label">{labels[i]}</span>
        </Wrap>
      ))}
    </div>
  );
}

export function LineChart({
  values,
  labels,
  label,
  hrefs,
}: {
  values: number[];
  labels: string[];
  label: string;
  hrefs?: Array<string | undefined>;
}) {
  const max = Math.max(1, ...values);
  const step = W / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${i * step},${H - 2 - (v / max) * (H - 6)}`);
  return (
    <div className="chart-line-box" role="img" aria-label={label}>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts.join(' ')} className="chart-line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div
        className="chart-line-hits"
        style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}
      >
        {values.map((v, i) => (
          <Wrap key={labels[i] ?? i} href={hrefs?.[i]} title={`${labels[i]}: ${v}`}>
            <span
              className="chart-dot-point"
              style={{ bottom: `${((H - 2 - (H - 2 - (v / max) * (H - 6))) / H) * 100}%` }}
            />
            <span className="chart-bar-label">{labels[i]}</span>
          </Wrap>
        ))}
      </div>
    </div>
  );
}

const SLICE_CLASSES = ['chart-s1', 'chart-s2', 'chart-s3', 'chart-s4', 'chart-s5'];

export function Donut({
  slices,
  label,
  centre,
}: {
  slices: Array<{ name: string; value: number; href?: string }>;
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
        const circle = (
          <circle
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
        return s.href ? (
          <a key={s.name} href={s.href} className="chart-slice-link">
            {circle}
          </a>
        ) : (
          <g key={s.name}>{circle}</g>
        );
      })}
      {centre}
    </svg>
  );
}

export const sliceClass = (i: number) => SLICE_CLASSES[i % SLICE_CLASSES.length]!;
