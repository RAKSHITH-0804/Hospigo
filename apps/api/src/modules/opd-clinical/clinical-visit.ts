import type { Prisma } from '../../generated/prisma';
import type { TenantTx } from '../../database/tenant-db';
import type { Actor } from '../opd-visits/opd-visits.service';
import { ageParts, type AgeParts } from '../../common/age';
import { clinicalError, ClinicalErrorCode } from './opd-clinical.errors';

/** What the clinical screens show about a visit (no money, ever). */
export const CLINICAL_VISIT_SELECT = {
  id: true,
  status: true,
  visitDate: true,
  tokenNo: true,
  tokenDate: true,
  queuedAt: true,
  consultationStartedAt: true,
  completedAt: true,
  doctorProfileId: true,
  receptionSymptoms: true,
  creator: { select: { displayName: true } },
  patient: {
    select: {
      id: true,
      uhid: true,
      name: true,
      gender: true,
      dateOfBirth: true,
      dobIsEstimated: true,
    },
  },
  doctor: { select: { id: true, code: true, user: { select: { displayName: true } } } },
} as const;

export type ClinicalVisitRow = Prisma.OpdVisitGetPayload<{ select: typeof CLINICAL_VISIT_SELECT }>;

export type VisitSummary = {
  id: string;
  status: string;
  visitDate: string;
  token: { date: string; no: number; label: string } | null;
  queuedAt: string | null;
  consultationStartedAt: string | null;
  completedAt: string | null;
  patient: {
    id: string;
    uhid: string;
    name: string;
    gender: string | null;
    ageYears: number | null;
    age: AgeParts | null;
    dobIsEstimated: boolean;
  };
  /** What the patient told reception, and who billed the visit. */
  receptionSymptoms: string | null;
  receptionistName: string;
  doctor: { id: string; code: string; name: string };
};

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Whole years between the date of birth and the hospital's local day (null without a birth date). */
export function ageInYears(dateOfBirth: Date | null, today: Date): number | null {
  if (!dateOfBirth) {
    return null;
  }
  let years = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) {
    years -= 1;
  }
  return Math.max(years, 0);
}

export function toVisitSummary(
  row: ClinicalVisitRow,
  tokenPrefix: string,
  today: Date,
): VisitSummary {
  return {
    id: row.id,
    status: row.status,
    visitDate: isoDate(row.visitDate),
    token:
      row.tokenNo !== null && row.tokenDate !== null
        ? { date: isoDate(row.tokenDate), no: row.tokenNo, label: `${tokenPrefix}${row.tokenNo}` }
        : null,
    queuedAt: row.queuedAt ? row.queuedAt.toISOString() : null,
    consultationStartedAt: row.consultationStartedAt
      ? row.consultationStartedAt.toISOString()
      : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    patient: {
      id: row.patient.id,
      uhid: row.patient.uhid,
      name: row.patient.name,
      gender: row.patient.gender,
      ageYears: ageInYears(row.patient.dateOfBirth, today),
      age: row.patient.dateOfBirth
        ? ageParts(
            {
              year: row.patient.dateOfBirth.getUTCFullYear(),
              month: row.patient.dateOfBirth.getUTCMonth() + 1,
              day: row.patient.dateOfBirth.getUTCDate(),
            },
            {
              year: today.getUTCFullYear(),
              month: today.getUTCMonth() + 1,
              day: today.getUTCDate(),
            },
          )
        : null,
      dobIsEstimated: row.patient.dobIsEstimated,
    },
    receptionSymptoms: row.receptionSymptoms,
    receptionistName: row.creator.displayName,
    doctor: { id: row.doctor.id, code: row.doctor.code, name: row.doctor.user.displayName },
  };
}

/**
 * The doctor profile of the caller, if they are a doctor. A doctor sees and changes only their
 * OWN visits; staff without a doctor profile (a nurse) work across the active branch.
 */
export async function ownDoctorId(tx: TenantTx, actor: Actor): Promise<string | null> {
  const profile = await tx.doctorProfile.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId },
    select: { id: true },
  });
  return profile?.id ?? null;
}

/**
 * Locks the visit row (FOR UPDATE) so two requests on one visit (a double click, a nurse and a
 * doctor at the same moment, "complete" racing "save") run one after the other and always see the
 * latest status. A visit of another branch or hospital, or of another doctor when the caller is a
 * doctor, is simply "not found" (never a hint that it exists).
 */
export async function lockVisit(
  tx: TenantTx,
  actor: Actor,
  visitId: string,
  own: string | null,
): Promise<void> {
  const rows =
    own === null
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM opd_visits
           WHERE id = ${visitId} AND tenant_id = ${actor.tenantId} AND branch_id = ${actor.branchId}
           FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM opd_visits
           WHERE id = ${visitId} AND tenant_id = ${actor.tenantId} AND branch_id = ${actor.branchId}
             AND doctor_profile_id = ${own}
           FOR UPDATE`;
  if (rows.length === 0) {
    throw clinicalError(404, ClinicalErrorCode.VISIT_NOT_FOUND);
  }
}

/** One visit of the ACTIVE branch (and of the caller's own when they are a doctor). */
export async function findClinicalVisit(
  tx: TenantTx,
  actor: Actor,
  visitId: string,
  own: string | null,
): Promise<ClinicalVisitRow> {
  const row = await tx.opdVisit.findFirst({
    where: {
      id: visitId,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      ...(own ? { doctorProfileId: own } : {}),
    },
    select: CLINICAL_VISIT_SELECT,
  });
  if (!row) {
    throw clinicalError(404, ClinicalErrorCode.VISIT_NOT_FOUND);
  }
  return row;
}
