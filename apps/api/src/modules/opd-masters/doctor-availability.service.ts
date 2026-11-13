import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../database/tenant-db';
import { requireContext } from '../../common/request-context';
import { zonedParts } from '../patients/uhid.util';
import { OPD_SETTINGS_DEFAULTS } from './opd-settings.defaults';

export type AvailabilityReason = 'SWITCH_OFF' | 'ON_LEAVE' | null;

export type DoctorAvailability = {
  available: boolean;
  reason: AvailabilityReason;
  outsideTimings: boolean;
};

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedWeekday(at: Date, timeZone: string): number {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at);
  const day = WEEKDAY_SHORT[label];
  if (day === undefined) {
    throw new Error(`Unable to resolve weekday for timezone ${timeZone}`);
  }
  return day;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateString(at: Date, timeZone: string): string {
  const { year, month, day } = zonedParts(at, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Prisma @db.Time values expose wall-clock as UTC components. */
function timeMinutesFromPrisma(t: Date): number {
  return t.getUTCHours() * 60 + t.getUTCMinutes();
}

function localMinutes(at: Date, timeZone: string): number {
  const { hour, minute } = zonedParts(at, timeZone);
  return hour * 60 + minute;
}

@Injectable()
export class DoctorAvailabilityService {
  constructor(private readonly tenantDb: TenantDb) {}

  async getAvailability(
    doctorProfileId: string,
    branchId: string,
    at: Date,
  ): Promise<DoctorAvailability> {
    return this.tenantDb.withTenant(async (tx) => {
      const ctx = requireContext();
      const tenantId = ctx.tenantId!;

      const settings = await tx.opdSettings.findUnique({ where: { tenantId } });
      const timeZone = settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;

      const profile = await tx.doctorProfile.findFirst({
        where: { tenantId, id: doctorProfileId },
      });
      if (!profile) {
        throw new Error('Doctor profile not found');
      }

      const weekday = zonedWeekday(at, timeZone);
      const dateStr = localDateString(at, timeZone);
      const minutes = localMinutes(at, timeZone);

      const leave = await tx.doctorLeave.findFirst({
        where: {
          tenantId,
          doctorProfileId,
          fromDate: { lte: new Date(`${dateStr}T00:00:00.000Z`) },
          toDate: { gte: new Date(`${dateStr}T00:00:00.000Z`) },
        },
      });

      let available = true;
      let reason: AvailabilityReason = null;
      if (!profile.availabilityOn) {
        available = false;
        reason = 'SWITCH_OFF';
      } else if (leave) {
        available = false;
        reason = 'ON_LEAVE';
      }

      const timings = await tx.doctorTiming.findMany({
        where: { tenantId, doctorProfileId, branchId },
      });

      let outsideTimings = false;
      if (timings.length > 0) {
        const today = timings.filter((t) => t.weekday === weekday);
        const inWindow = today.some((t) => {
          const start = timeMinutesFromPrisma(t.startTime);
          const end = timeMinutesFromPrisma(t.endTime);
          return minutes >= start && minutes < end;
        });
        outsideTimings = !inWindow;
      }

      return { available, reason, outsideTimings };
    });
  }
}
