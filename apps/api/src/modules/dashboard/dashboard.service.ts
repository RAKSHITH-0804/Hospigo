import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { ownDoctorId } from '../opd-clinical/clinical-visit';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import type { Actor } from '../opd-visits/opd-visits.service';

/** The trend charts show this many days; the payment mix and top doctors use the longer window. */
export const DASHBOARD_TREND_DAYS = 14;
export const DASHBOARD_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const OPEN_STATUSES = ['WAITING', 'IN_CONSULTATION'];

export type DashboardSummary = {
  branchId: string;
  /** Which blocks the caller may see (the screens show only these). */
  sections: {
    money: boolean;
    queue: boolean;
    vitals: boolean;
    doctor: boolean;
    approvals: boolean;
  };
  today: {
    registrations: number;
    visits: number;
    waiting: number;
    completed: number;
    collectionPaise: number | null;
  };
  trend: Array<{ date: string; visits: number; collectionPaise: number | null }>;
  paymentMix: Array<{ mode: string; amountPaise: number }>;
  topDoctors: Array<{ doctor: string; visits: number }>;
  vitals: { waiting: number; recordedToday: number } | null;
  doctor: { myWaiting: number; mySeenToday: number } | null;
  pendingApprovals: number | null;
};

/**
 * Step 2.1d: the numbers behind the dashboards. Everything is counted from real rows of the active
 * branch; nothing is invented here or on the screen. A block the caller may not see (money,
 * clinical) is left out by the permission checks.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async summary(actor: Actor): Promise<DashboardSummary> {
    const [money, queue, vitalsRead, approvals] = await Promise.all([
      this.access.can('opd.billing.read', actor.branchId, 'OPD'),
      this.access.can('opd.visits.read', actor.branchId, 'OPD'),
      this.access.can('opd.vitals.read', actor.branchId, 'OPD'),
      this.access.can('opd.refunds.approve', actor.branchId, 'OPD'),
    ]);
    return this.tenantDb.withTenant(async (tx) => {
      const settings = await tx.opdSettings.findFirst({ where: { tenantId: actor.tenantId } });
      const timeZone = settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
      const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone });
      const now = this.clock.now();
      const today = dayKey(now);
      const keys = Array.from({ length: DASHBOARD_TREND_DAYS }, (_, i) =>
        dayKey(new Date(now.getTime() - (DASHBOARD_TREND_DAYS - 1 - i) * DAY_MS)),
      );
      const since = new Date(now.getTime() - (DASHBOARD_WINDOW_DAYS + 1) * DAY_MS);
      const sinceDay = new Date(`${dayKey(since)}T00:00:00.000Z`);
      const recent = new Date(now.getTime() - 2 * DAY_MS);
      const own = await ownDoctorId(tx, actor);

      const visits = queue
        ? await tx.opdVisit.findMany({
            where: {
              tenantId: actor.tenantId,
              branchId: actor.branchId,
              visitDate: { gte: sinceDay },
              status: { not: 'CANCELLED' },
            },
            select: {
              id: true,
              visitDate: true,
              status: true,
              doctorProfileId: true,
              doctor: { select: { user: { select: { displayName: true } } } },
            },
          })
        : [];
      // a visit belongs to its visit date (the business day), not to the moment the row was written
      const visitDay = (v: { visitDate: Date }) => v.visitDate.toISOString().slice(0, 10);
      const todays = visits.filter((v) => visitDay(v) === today);

      const newPatients = await tx.patient.findMany({
        where: {
          tenantId: actor.tenantId,
          registeredBranchId: actor.branchId,
          createdAt: { gte: recent },
        },
        select: { createdAt: true },
      });
      const registrations = newPatients.filter((p) => dayKey(p.createdAt) === today).length;

      const payments = money
        ? await tx.payment.findMany({
            where: { tenantId: actor.tenantId, branchId: actor.branchId, paidAt: { gte: since } },
            select: { amountPaise: true, paidAt: true, paymentMode: { select: { name: true } } },
          })
        : [];
      const collectionByDay = new Map<string, number>();
      const mix = new Map<string, number>();
      for (const p of payments) {
        const key = dayKey(p.paidAt);
        collectionByDay.set(key, (collectionByDay.get(key) ?? 0) + p.amountPaise);
        mix.set(p.paymentMode.name, (mix.get(p.paymentMode.name) ?? 0) + p.amountPaise);
      }

      const perDoctor = new Map<string, number>();
      for (const v of visits) {
        const name = v.doctor.user.displayName;
        perDoctor.set(name, (perDoctor.get(name) ?? 0) + 1);
      }

      let vitals: DashboardSummary['vitals'] = null;
      if (vitalsRead) {
        const recorded = await tx.visitVitals.findMany({
          where: { tenantId: actor.tenantId, branchId: actor.branchId, createdAt: { gte: recent } },
          select: { visitId: true, createdAt: true },
        });
        const hasVitals = new Set(recorded.map((r) => r.visitId));
        const recordedToday = new Set(
          recorded.filter((r) => dayKey(r.createdAt) === today).map((r) => r.visitId),
        );
        vitals = {
          waiting: todays.filter((v) => v.status === 'WAITING' && !hasVitals.has(v.id)).length,
          recordedToday: recordedToday.size,
        };
      }

      const pendingApprovals = approvals
        ? await tx.refundRequest.count({
            where: { tenantId: actor.tenantId, branchId: actor.branchId, status: 'REQUESTED' },
          })
        : null;

      return {
        branchId: actor.branchId,
        sections: { money, queue, vitals: vitalsRead, doctor: own !== null, approvals },
        today: {
          registrations,
          visits: todays.length,
          waiting: todays.filter((v) => OPEN_STATUSES.includes(v.status)).length,
          completed: todays.filter((v) => v.status === 'COMPLETED').length,
          collectionPaise: money ? (collectionByDay.get(today) ?? 0) : null,
        },
        trend: keys.map((date) => ({
          date,
          visits: visits.filter((v) => visitDay(v) === date).length,
          collectionPaise: money ? (collectionByDay.get(date) ?? 0) : null,
        })),
        paymentMix: [...mix]
          .map(([mode, amountPaise]) => ({ mode, amountPaise }))
          .sort((a, b) => b.amountPaise - a.amountPaise),
        topDoctors: [...perDoctor]
          .map(([doctor, count]) => ({ doctor, visits: count }))
          .sort((a, b) => b.visits - a.visits)
          .slice(0, 5),
        vitals,
        doctor:
          own === null
            ? null
            : {
                myWaiting: todays.filter(
                  (v) => v.doctorProfileId === own && OPEN_STATUSES.includes(v.status),
                ).length,
                mySeenToday: todays.filter(
                  (v) => v.doctorProfileId === own && v.status === 'COMPLETED',
                ).length,
              },
        pendingApprovals,
      };
    });
  }
}
