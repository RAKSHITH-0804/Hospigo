'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart, Donut, LineChart, sliceClass } from '@/components/dashboard/charts';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { DashboardSummary } from '@/lib/dashboard/types';

const copy = staffCopy.dashboard.insights;

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi-card">
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
    </div>
  );
}

const attentionCopy = staffCopy.dashboard.attention;

/** Real things that wait for someone: requests to decide, patients waiting for vitals, long waits. */
function Attention({ data }: { data: DashboardSummary }) {
  const items: Array<{ key: string; text: string; href: string }> = [];
  if (data.pendingApprovals) {
    items.push({
      key: 'requests',
      text: attentionCopy.requests.replace('{n}', String(data.pendingApprovals)),
      href: '/app/opd/refunds',
    });
  }
  if (data.vitals?.waiting) {
    items.push({
      key: 'vitals',
      text: attentionCopy.vitals.replace('{n}', String(data.vitals.waiting)),
      href: '/app/opd',
    });
  }
  if (data.today.longWaiting) {
    items.push({
      key: 'long',
      text: attentionCopy.longWaits
        .replace('{n}', String(data.today.longWaiting))
        .replace('{minutes}', String(attentionCopy.minutes)),
      href: '/app/opd',
    });
  }
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <h2 className="type-label-strong">{attentionCopy.title}</h2>
      {items.length === 0 ? (
        <p className="type-label text-muted-foreground">{attentionCopy.none}</p>
      ) : (
        <ul className="attention-list">
          {items.map((item) => (
            <li key={item.key} className="attention-item">
              <span className="type-body">{item.text}</span>
              <Link href={item.href} className="type-label-strong underline">
                {attentionCopy.open}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const shortDay = (d: string) => d.slice(5);

/**
 * Real numbers for the active branch from /dashboard/summary (counted from stored rows; a block the
 * person may not see is simply not sent). Skeleton while loading, plain message on failure or no data.
 */
export function DashboardInsights({ allBranches = false }: { allBranches?: boolean }) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    fetch(`/api/staff/dashboard/summary${allBranches ? '?branch=ALL' : ''}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) {
          throw new Error('bad');
        }
        const body = (await r.json()) as DashboardSummary;
        if (!stopped) {
          setData(body);
        }
      })
      .catch(() => {
        if (!stopped) {
          setFailed(true);
        }
      });
    return () => {
      stopped = true;
    };
  }, []);

  if (failed) {
    return (
      <p role="alert" className="type-label text-destructive">
        {copy.failed}
      </p>
    );
  }
  if (!data) {
    return (
      <div
        className="dash-insights kpi-grid kpi-skeleton"
        aria-busy="true"
        aria-label={copy.loading}
      />
    );
  }
  const s = data.sections;
  const days = data.trend.map((t) => shortDay(t.date));
  const mixTotal = data.paymentMix.reduce((a, m) => a + m.amountPaise, 0);
  const hasVisits = data.trend.some((t) => t.visits > 0);
  return (
    <section className="dash-insights" aria-label={copy.title}>
      <div className="kpi-grid">
        {s.queue ? <Kpi label={copy.visitsToday} value={data.today.visits} /> : null}
        {s.queue ? <Kpi label={copy.waiting} value={data.today.waiting} /> : null}
        {s.queue ? <Kpi label={copy.completed} value={data.today.completed} /> : null}
        <Kpi label={copy.registrations} value={data.today.registrations} />
        {s.money && data.today.collectionPaise !== null ? (
          <Kpi label={copy.collection} value={formatPaise(data.today.collectionPaise)} />
        ) : null}
        {s.vitals && data.vitals ? (
          <Kpi label={copy.vitalsWaiting} value={data.vitals.waiting} />
        ) : null}
        {s.doctor && data.doctor ? (
          <>
            <Kpi label={copy.myWaiting} value={data.doctor.myWaiting} />
            <Kpi label={copy.mySeen} value={data.doctor.mySeenToday} />
          </>
        ) : null}
        {s.approvals && data.pendingApprovals !== null ? (
          <Kpi label={copy.approvals} value={data.pendingApprovals} />
        ) : null}
      </div>
      {s.queue || s.approvals ? <Attention data={data} /> : null}
      {s.queue && !hasVisits ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : null}
      {s.queue && hasVisits ? (
        <div className="chart-grid">
          <div className="chart-card">
            <p className="type-label text-muted-foreground">{copy.visitsTrend}</p>
            <BarChart
              values={data.trend.map((t) => t.visits)}
              labels={days}
              label={copy.visitsTrend}
            />
          </div>
          {s.money ? (
            <div className="chart-card">
              <p className="type-label text-muted-foreground">{copy.collectionTrend}</p>
              <LineChart
                values={data.trend.map((t) => t.collectionPaise ?? 0)}
                labels={days}
                label={copy.collectionTrend}
              />
            </div>
          ) : null}
          {s.money && mixTotal > 0 ? (
            <div className="chart-card">
              <p className="type-label text-muted-foreground">{copy.paymentMix}</p>
              <div className="chart-donut-row">
                <Donut
                  slices={data.paymentMix.map((m) => ({ name: m.mode, value: m.amountPaise }))}
                  label={copy.paymentMix}
                />
                <ul className="chart-legend type-label">
                  {data.paymentMix.map((m, i) => (
                    <li key={m.mode}>
                      <span className={`chart-dot ${sliceClass(i)}`} aria-hidden="true" />
                      {m.mode} · {formatPaise(m.amountPaise)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {data.topDoctors.length > 0 ? (
            <div className="chart-card">
              <p className="type-label text-muted-foreground">{copy.topDoctors}</p>
              <ol className="chart-legend type-label">
                {data.topDoctors.map((d) => (
                  <li key={d.doctor}>
                    {d.doctor} · {d.visits}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
