'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HeartPulse,
  IndianRupee,
  ShieldAlert,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { BarChart, Donut, LineChart, sliceClass } from '@/components/dashboard/charts';
import { formatPaise } from '@/config/money';
import { staffCopy } from '@/config/staff-copy';
import type { DashboardSummary } from '@/lib/dashboard/types';

const copy = staffCopy.dashboard.insights;

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
  href,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: string;
  /** Where the block leads; none when the person may not open that screen. */
  href?: string;
}) {
  const body = (
    <>
      <span className="icon-tile icon-tile-solid">
        <Icon aria-hidden="true" />
      </span>
      <div className="kpi-text">
        <p className="kpi-label">{label}</p>
        <p className="kpi-value">{value}</p>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={`kpi-card kpi-link ${tone}`}>
      {body}
    </Link>
  ) : (
    <div className={`kpi-card ${tone}`}>{body}</div>
  );
}

const attentionCopy = staffCopy.dashboard.attention;

/** Real things that wait for someone: requests to decide, patients waiting for vitals, long waits. */
function Attention({ data }: { data: DashboardSummary }) {
  const items: Array<{ key: string; text: string; href: string; tone: string; icon: LucideIcon }> =
    [];
  if (data.pendingApprovals) {
    items.push({
      key: 'requests',
      text: attentionCopy.requests.replace('{n}', String(data.pendingApprovals)),
      href: '/app/opd/refunds',
      tone: 'tone-rose',
      icon: ShieldAlert,
    });
  }
  if (data.vitals?.waiting) {
    items.push({
      key: 'vitals',
      text: attentionCopy.vitals.replace('{n}', String(data.vitals.waiting)),
      href: '/app/opd',
      tone: 'tone-amber',
      icon: HeartPulse,
    });
  }
  if (data.today.longWaiting) {
    items.push({
      key: 'long',
      text: attentionCopy.longWaits
        .replace('{n}', String(data.today.longWaiting))
        .replace('{minutes}', String(attentionCopy.minutes)),
      href: '/app/opd',
      tone: 'tone-orange',
      icon: AlertTriangle,
    });
  }
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <h2 className="type-heading font-bold text-foreground">{attentionCopy.title}</h2>
      {items.length === 0 ? (
        <p className="type-label text-muted-foreground">{attentionCopy.none}</p>
      ) : (
        <ul className="attention-list">
          {items.map((item) => (
            <li key={item.key} className={`attention-item ${item.tone}`}>
              <span className="attention-text">
                <span className="icon-tile icon-tile-solid">
                  <item.icon aria-hidden="true" />
                </span>
                <span className="type-body font-semibold">{item.text}</span>
              </span>
              <Link href={item.href} className={cn(buttonVariants({ variant: 'outline' }))}>
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
export function DashboardInsights({
  allBranches = false,
  permissions = [],
}: {
  allBranches?: boolean;
  /** What the person may open: a block or chart is a link only when its screen is open to them. */
  permissions?: readonly string[];
}) {
  const can = (code: string) => permissions.includes(code);
  const toQueue = can('opd.queue.read') ? '/app/opd' : undefined;
  const toReport = can('opd.reports.read') ? '/app/opd/reports' : undefined;
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
        {s.queue ? (
          <Kpi
            label={copy.visitsToday}
            value={data.today.visits}
            icon={Users}
            tone="tone-blue"
            href={toQueue}
          />
        ) : null}
        {s.queue ? (
          <Kpi
            label={copy.waiting}
            value={data.today.waiting}
            icon={Clock}
            tone="tone-amber"
            href={toQueue}
          />
        ) : null}
        {s.queue ? (
          <Kpi
            label={copy.completed}
            value={data.today.completed}
            icon={CheckCircle2}
            tone="tone-green"
            href={toQueue}
          />
        ) : null}
        <Kpi
          label={copy.registrations}
          value={data.today.registrations}
          icon={UserPlus}
          tone="tone-violet"
          href={can('patients.registry.read') ? '/app/patients' : undefined}
        />
        {s.money && data.today.collectionPaise !== null ? (
          <Kpi
            label={copy.collection}
            value={formatPaise(data.today.collectionPaise)}
            icon={IndianRupee}
            tone="tone-teal"
            href={toReport}
          />
        ) : null}
        {s.vitals && data.vitals ? (
          <Kpi
            label={copy.vitalsWaiting}
            value={data.vitals.waiting}
            icon={HeartPulse}
            tone="tone-rose"
            href={toQueue}
          />
        ) : null}
        {s.doctor && data.doctor ? (
          <>
            <Kpi
              label={copy.myWaiting}
              value={data.doctor.myWaiting}
              icon={Clock}
              tone="tone-amber"
              href={toQueue}
            />
            <Kpi
              label={copy.mySeen}
              value={data.doctor.mySeenToday}
              icon={CheckCircle2}
              tone="tone-green"
              href={toQueue}
            />
          </>
        ) : null}
        {s.approvals && data.pendingApprovals !== null ? (
          <Kpi
            label={copy.approvals}
            value={data.pendingApprovals}
            icon={ShieldAlert}
            tone="tone-orange"
            href={can('opd.refunds.approve') ? '/app/opd/refunds' : undefined}
          />
        ) : null}
      </div>
      {s.queue || s.approvals ? <Attention data={data} /> : null}
      {s.queue && !hasVisits ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : null}
      {s.queue && hasVisits ? (
        <div className="chart-grid">
          <div className="chart-card tone-blue">
            <p>{copy.visitsTrend}</p>
            <BarChart
              values={data.trend.map((t) => t.visits)}
              labels={days}
              label={copy.visitsTrend}
              hrefs={data.trend.map((t) => (toReport ? `${toReport}?date=${t.date}` : undefined))}
            />
          </div>
          {s.money ? (
            <div className="chart-card tone-teal">
              <p>{copy.collectionTrend}</p>
              <LineChart
                values={data.trend.map((t) => t.collectionPaise ?? 0)}
                labels={days}
                label={copy.collectionTrend}
                hrefs={data.trend.map((t) => (toReport ? `${toReport}?date=${t.date}` : undefined))}
              />
            </div>
          ) : null}
          {s.money && mixTotal > 0 ? (
            <div className="chart-card tone-violet">
              <p>{copy.paymentMix}</p>
              <div className="chart-donut-row">
                <Donut
                  slices={data.paymentMix.map((m) => ({
                    name: m.mode,
                    value: m.amountPaise,
                    href: toReport
                      ? `${toReport}?paymentMode=${encodeURIComponent(m.code)}`
                      : undefined,
                  }))}
                  label={copy.paymentMix}
                />
                <ul className="chart-legend type-label">
                  {data.paymentMix.map((m, i) => (
                    <li key={m.mode}>
                      <span className={`chart-dot ${sliceClass(i)}`} aria-hidden="true" />
                      {toReport ? (
                        <Link href={`${toReport}?paymentMode=${encodeURIComponent(m.code)}`}>
                          {m.mode} · {formatPaise(m.amountPaise)}
                        </Link>
                      ) : (
                        <>
                          {m.mode} · {formatPaise(m.amountPaise)}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {data.topDoctors.length > 0 ? (
            <div className="chart-card tone-amber">
              <p>{copy.topDoctors}</p>
              <ol className="chart-legend type-label">
                {data.topDoctors.map((d) => (
                  <li key={d.doctorId}>
                    {toReport ? (
                      <Link href={`${toReport}?doctor=${encodeURIComponent(d.doctorId)}`}>
                        {d.doctor} · {d.visits}
                      </Link>
                    ) : (
                      <>
                        {d.doctor} · {d.visits}
                      </>
                    )}
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
