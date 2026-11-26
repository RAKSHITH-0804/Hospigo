import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb } from '../../database/tenant-db';
import type { Actor } from '../opd-visits/opd-visits.service';
import { ownDoctorId } from './clinical-visit';
import { effectiveSnapshotOf, type NoteSnapshot } from './consultation.service';
import { clinicalError, ClinicalErrorCode as E } from './opd-clinical.errors';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Most visits one call returns: "the full history at once" without an endless answer. */
export const HISTORY_MAX_VISITS = 200;
/** A viewer is written to the log at most once in this time for one patient. */
export const HISTORY_LOG_WINDOW_MS = 60 * 60 * 1000;

export type PatientHistoryVisit = {
  visitId: string;
  visitDate: string;
  status: string;
  branch: { id: string; name: string };
  doctor: { id: string; name: string };
  receptionSymptoms: string | null;
  consultation: null | {
    complaints: string | null;
    diagnosis: string | null;
    advice: string | null;
    followUpDate: string | null;
    completed: boolean;
    amended: boolean;
  };
  prescription: NoteSnapshot['prescription'];
};

/**
 * Step 2.1b: a doctor (or the Indigo Owner) reads one patient of the hospital with the whole history,
 * read-only, across all branches and doctors. The permission patients.history.view_all decides who.
 * The view is written to the append-only patient_view_log (ids only), unless the reader is the
 * assigned doctor with an open visit of that patient, and at most once an hour per reader and patient.
 */
@Injectable()
export class PatientHistoryService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async history(
    patientId: string,
    actor: Actor,
  ): Promise<{ patientId: string; logged: boolean; visits: PatientHistoryVisit[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: patientId, tenantId: actor.tenantId },
        select: { id: true },
      });
      if (!patient) {
        throw clinicalError(404, E.VISIT_NOT_FOUND);
      }

      const own = await ownDoctorId(tx, actor);
      const openVisit = own
        ? await tx.opdVisit.findFirst({
            where: {
              tenantId: actor.tenantId,
              patientId,
              doctorProfileId: own,
              status: { in: ['WAITING', 'IN_CONSULTATION'] },
            },
            select: { id: true },
          })
        : null;
      let logged = false;
      if (!openVisit) {
        const since = new Date(this.clock.now().getTime() - HISTORY_LOG_WINDOW_MS);
        const recent = await tx.patientViewLog.findFirst({
          where: {
            tenantId: actor.tenantId,
            viewerUserId: actor.userId,
            patientId,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (!recent) {
          await tx.patientViewLog.create({
            data: {
              tenantId: actor.tenantId,
              branchId: actor.branchId,
              viewerUserId: actor.userId,
              patientId,
            },
          });
          logged = true;
        }
      }

      const visits = await tx.opdVisit.findMany({
        where: { tenantId: actor.tenantId, patientId },
        orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
        take: HISTORY_MAX_VISITS,
        select: {
          id: true,
          visitDate: true,
          status: true,
          receptionSymptoms: true,
          branch: { select: { id: true, name: true } },
          doctor: { select: { id: true, user: { select: { displayName: true } } } },
          consultation: {
            include: {
              prescriptionItems: { orderBy: { lineNo: 'asc' } },
              versions: {
                orderBy: { versionNo: 'asc' },
                select: { versionNo: true, snapshot: true },
              },
            },
          },
        },
      });
      return {
        patientId,
        logged,
        visits: visits.map((v): PatientHistoryVisit => {
          const note = v.consultation;
          const now = note ? effectiveSnapshotOf(note) : null;
          return {
            visitId: v.id,
            visitDate: isoDate(v.visitDate),
            status: v.status,
            branch: v.branch,
            doctor: { id: v.doctor.id, name: v.doctor.user.displayName },
            receptionSymptoms: v.receptionSymptoms,
            consultation:
              note && now
                ? {
                    complaints: now.complaints,
                    diagnosis: now.diagnosis,
                    advice: now.advice,
                    followUpDate: now.followUpDate,
                    completed: note.status === 'COMPLETED',
                    amended: note.versions.length > 0,
                  }
                : null,
            prescription: now ? now.prescription : [],
          };
        }),
      };
    });
  }
}
