import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { zonedParts } from '../patients/uhid.util';
import { localDate, type Actor } from '../opd-visits/opd-visits.service';
import {
  CLINICAL_VISIT_SELECT,
  findClinicalVisit,
  lockVisit,
  ownDoctorId,
  toVisitSummary,
  type ClinicalVisitRow,
} from './clinical-visit';
import type {
  AddendumDto,
  PrescriptionItemDto,
  SaveNoteDto,
  SavePrescriptionDto,
} from './dto/clinical.dto';
import { OPD_CLINICAL_AUDIT as AUDIT, OPD_CLINICAL_CONFIG as C } from './opd-clinical.config';
import { clinicalError, ClinicalErrorCode as E } from './opd-clinical.errors';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const clean = (s: string | undefined): string | null => {
  const t = s?.trim() ?? '';
  return t === '' ? null : t;
};

const NOTE_INCLUDE = {
  prescriptionItems: { orderBy: { lineNo: 'asc' } },
  addenda: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { author: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.ConsultationInclude;

type NoteRow = Prisma.ConsultationGetPayload<{ include: typeof NOTE_INCLUDE }>;

function toNoteView(note: NoteRow | null) {
  if (!note) {
    return { consultation: null, prescription: [], addenda: [] };
  }
  return {
    consultation: {
      id: note.id,
      status: note.status,
      complaints: note.complaints,
      diagnosis: note.diagnosis,
      advice: note.advice,
      followUpDate: note.followUpDate ? isoDate(note.followUpDate) : null,
      completedAt: note.completedAt ? note.completedAt.toISOString() : null,
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    },
    prescription: note.prescriptionItems.map((i) => ({
      lineNo: i.lineNo,
      medicineId: i.medicineId,
      medicineName: i.medicineName,
      isUnlisted: i.isUnlisted,
      dose: i.dose,
      frequency: i.frequency,
      duration: i.duration,
      instructions: i.instructions,
    })),
    addenda: note.addenda.map((a) => ({
      id: a.id,
      text: a.addendumText,
      reason: a.reason,
      addedBy: { id: a.author.id, name: a.author.displayName },
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

/**
 * Step 5a-2: the doctor's queue, starting a consultation, the consultation note, the prescription
 * and addenda. A doctor sees and changes only their OWN visits; every note read is audited. The
 * database refuses the rest (completed notes are frozen, a visit completes only with a completed
 * note, ...); this service gives clean errors first. The branch always comes from the token.
 */
@Injectable()
export class ConsultationService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ----------------------------------------------------------------------------- medicines

  /**
   * Active medicines of the hospital matching a text (name, code or composition), by name. This
   * feeds the prescription picker; a prescription row copies the NAME from this list on the server.
   */
  async searchMedicines(actor: Actor, q: string, limit: number) {
    const text = q.trim().slice(0, C.medicineSearchMaxLength);
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.medicine.findMany({
        where: {
          tenantId: actor.tenantId,
          active: true,
          ...(text
            ? {
                OR: [
                  { name: { contains: text, mode: 'insensitive' } },
                  { code: { contains: text, mode: 'insensitive' } },
                  { composition: { contains: text, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: Math.min(Math.max(limit, 1), C.medicineSearchMaxLimit),
        select: { id: true, code: true, name: true, composition: true, form: true },
      });
      return { items: rows };
    });
  }

  // ------------------------------------------------------------------------------- queue

  /**
   * The branch's visits that matter on the floor, in two groups:
   *  - every WAITING and IN_CONSULTATION visit, oldest payment first. There is deliberately NO
   *    "today only" filter here: a patient still waiting after midnight must not vanish (each item
   *    carries its own visitDate so the screen can flag older ones);
   *  - the visits COMPLETED today (hospital time zone), latest first, so doctors, nurses and
   *    reception can see who has been attended.
   * A doctor sees only their own; everyone else with the permission (a nurse, reception) sees the
   * whole branch. Names, tokens and status only: no clinical text, no money.
   */
  async queue(actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const { prefix, today, startOfToday } = await this.dayInfo(tx, actor);
      const own = await ownDoctorId(tx, actor);
      const rows = await tx.opdVisit.findMany({
        where: {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          OR: [
            { status: { in: ['WAITING', 'IN_CONSULTATION'] } },
            { status: 'COMPLETED', completedAt: { gte: startOfToday } },
          ],
          ...(own ? { doctorProfileId: own } : {}),
        },
        select: CLINICAL_VISIT_SELECT,
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
      });
      const open = rows.filter((r) => r.status !== 'COMPLETED');
      const done = rows
        .filter((r) => r.status === 'COMPLETED')
        .sort(
          (a, b) =>
            (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0) ||
            b.id.localeCompare(a.id),
        );
      const ordered = [...open, ...done];
      const withVitals = await tx.visitVitals.findMany({
        where: { tenantId: actor.tenantId, visitId: { in: ordered.map((r) => r.id) } },
        select: { visitId: true },
        distinct: ['visitId'],
      });
      const hasVitals = new Set(withVitals.map((v) => v.visitId));
      return {
        date: isoDate(today),
        scope: own ? 'OWN' : 'BRANCH',
        total: ordered.length,
        items: ordered.map((r) => ({
          ...toVisitSummary(r, prefix, today),
          vitalsRecorded: hasVitals.has(r.id),
        })),
      };
    });
  }

  // ------------------------------------------------------------------------------- start

  /** WAITING -> IN_CONSULTATION by the assigned doctor. A second click returns the same state. */
  async start(visitId: string, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const { visit } = await this.doctorContext(tx, actor, visitId);
      const { prefix, today } = await this.dayInfo(tx, actor);
      if (visit.status === 'IN_CONSULTATION') {
        return { replayed: true, visit: toVisitSummary(visit, prefix, today) };
      }
      if (visit.status !== 'WAITING') {
        throw clinicalError(409, E.VISIT_NOT_WAITING, { status: visit.status });
      }
      const now = this.clock.now();
      const moved = await tx.opdVisit.updateMany({
        where: { id: visit.id, tenantId: actor.tenantId, status: 'WAITING' },
        data: { status: 'IN_CONSULTATION', consultationStartedAt: now },
      });
      if (moved.count !== 1) {
        throw clinicalError(409, E.VISIT_NOT_WAITING);
      }
      await this.audit(tx, actor, AUDIT.visitStarted, 'opd_visit', visit.id, {
        doctorProfileId: visit.doctorProfileId,
      });
      const fresh = await findClinicalVisit(tx, actor, visit.id, visit.doctorProfileId);
      return { replayed: false, visit: toVisitSummary(fresh, prefix, today) };
    });
  }

  // ---------------------------------------------------------------------------- note (draft)

  /** Saves the draft note (replaces the four fields). Allowed only while IN_CONSULTATION. */
  async saveNote(visitId: string, body: SaveNoteDto, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const { own, visit } = await this.doctorContext(tx, actor, visitId);
      this.requireInConsultation(visit);
      const fields = {
        complaints: clean(body.complaints),
        diagnosis: clean(body.diagnosis),
        advice: clean(body.advice),
        followUpDate: this.parseFollowUp(body.followUpDate, visit.visitDate),
      };
      const existing = await this.findNote(tx, actor, visit.id);
      if (existing && existing.status === 'COMPLETED') {
        throw clinicalError(409, E.NOTE_ALREADY_COMPLETED);
      }
      const saved = existing
        ? await tx.consultation.update({ where: { id: existing.id }, data: fields })
        : await tx.consultation.create({
            data: {
              tenantId: actor.tenantId,
              branchId: actor.branchId,
              visitId: visit.id,
              doctorProfileId: own,
              ...fields,
            },
          });
      // Audit: which fields hold text, never the text itself.
      await this.audit(tx, actor, AUDIT.noteSaved, 'consultation', saved.id, {
        visitId: visit.id,
        fieldsFilled: (['complaints', 'diagnosis', 'advice', 'followUpDate'] as const).filter(
          (f) => fields[f] !== null,
        ),
      });
      return toNoteView(await this.findNote(tx, actor, visit.id));
    });
  }

  /** Replaces the whole prescription of the DRAFT note (an empty list clears it). */
  async savePrescription(visitId: string, body: SavePrescriptionDto, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const { own, visit } = await this.doctorContext(tx, actor, visitId);
      this.requireInConsultation(visit);
      const rows = await this.resolvePrescription(tx, actor, body.items);
      let note = await this.findNote(tx, actor, visit.id);
      if (note && note.status === 'COMPLETED') {
        throw clinicalError(409, E.NOTE_ALREADY_COMPLETED);
      }
      if (!note) {
        await tx.consultation.create({
          data: {
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            visitId: visit.id,
            doctorProfileId: own,
          },
        });
        note = await this.findNote(tx, actor, visit.id);
      }
      const noteId = note!.id;
      await tx.prescriptionItem.deleteMany({
        where: { tenantId: actor.tenantId, consultationId: noteId },
      });
      if (rows.length > 0) {
        await tx.prescriptionItem.createMany({
          data: rows.map((r, index) => ({
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            visitId: visit.id,
            consultationId: noteId,
            lineNo: index + 1,
            ...r,
          })),
        });
      }
      // Audit: counts only (no medicine names).
      await this.audit(tx, actor, AUDIT.prescriptionSaved, 'consultation', noteId, {
        visitId: visit.id,
        itemCount: rows.length,
        unlistedCount: rows.filter((r) => r.isUnlisted).length,
      });
      return toNoteView(await this.findNote(tx, actor, visit.id));
    });
  }

  // ------------------------------------------------------------------------------ complete

  /** Completes the note and the visit together. A second click returns the finished result. */
  async complete(visitId: string, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const { visit } = await this.doctorContext(tx, actor, visitId);
      const { prefix, today } = await this.dayInfo(tx, actor);
      const note = await this.findNote(tx, actor, visit.id);
      if (visit.status === 'COMPLETED' && note?.status === 'COMPLETED') {
        return {
          replayed: true,
          visit: toVisitSummary(visit, prefix, today),
          ...toNoteView(note),
        };
      }
      this.requireInConsultation(visit);
      if (
        !note ||
        (clean(note.complaints ?? undefined) === null &&
          clean(note.diagnosis ?? undefined) === null)
      ) {
        throw clinicalError(400, E.NOTE_EMPTY);
      }
      const now = this.clock.now();
      const closedNote = await tx.consultation.updateMany({
        where: { id: note.id, tenantId: actor.tenantId, status: 'DRAFT' },
        data: { status: 'COMPLETED', completedAt: now },
      });
      const closedVisit = await tx.opdVisit.updateMany({
        where: { id: visit.id, tenantId: actor.tenantId, status: 'IN_CONSULTATION' },
        data: { status: 'COMPLETED', completedAt: now },
      });
      if (closedNote.count !== 1 || closedVisit.count !== 1) {
        throw clinicalError(409, E.VISIT_NOT_IN_CONSULTATION);
      }
      await this.audit(tx, actor, AUDIT.visitCompleted, 'opd_visit', visit.id, {
        consultationId: note.id,
        prescriptionItems: note.prescriptionItems.length,
      });
      const fresh = await findClinicalVisit(tx, actor, visit.id, visit.doctorProfileId);
      return {
        replayed: false,
        visit: toVisitSummary(fresh, prefix, today),
        ...toNoteView(await this.findNote(tx, actor, visit.id)),
      };
    });
  }

  // ------------------------------------------------------------------------------ addendum

  /** A correction of a COMPLETED note: new text, who, when and why. The note itself stays frozen. */
  async addAddendum(visitId: string, body: AddendumDto, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const { visit } = await this.doctorContext(tx, actor, visitId);
      const text = clean(body.text);
      const reason = clean(body.reason);
      if (text === null || reason === null) {
        throw clinicalError(400, E.ADDENDUM_INVALID);
      }
      const note = await this.findNote(tx, actor, visit.id);
      if (!note || note.status !== 'COMPLETED' || visit.status !== 'COMPLETED') {
        throw clinicalError(409, E.ADDENDUM_NEEDS_COMPLETED_NOTE);
      }
      const addendum = await tx.consultationAddendum.create({
        data: {
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          consultationId: note.id,
          visitId: visit.id,
          addendumText: text,
          reason,
          addedBy: actor.userId,
        },
      });
      await this.audit(tx, actor, AUDIT.addendumAdded, 'consultation_addendum', addendum.id, {
        visitId: visit.id,
        consultationId: note.id,
      });
      return toNoteView(await this.findNote(tx, actor, visit.id));
    });
  }

  // ---------------------------------------------------------------------------------- read

  /**
   * The note, prescription and addenda of one visit. Only a doctor (own visit) or a nurse (any
   * visit of the active branch) gets here; the permission is checked by the route. EVERY read is
   * audited (who, which visit, when; never the text).
   */
  async getNote(visitId: string, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const own = await ownDoctorId(tx, actor);
      const visit = await findClinicalVisit(tx, actor, visitId, own);
      const { prefix, today } = await this.dayInfo(tx, actor);
      const note = await this.findNote(tx, actor, visit.id);
      await this.audit(tx, actor, AUDIT.noteRead, 'opd_visit', visit.id, {
        consultationStatus: note?.status ?? null,
        addenda: note?.addenda.length ?? 0,
      });
      return { visit: toVisitSummary(visit, prefix, today), ...toNoteView(note) };
    });
  }

  // -------------------------------------------------------------------------------- helpers

  /** A doctor acts on their own visit: the profile, the row lock and the visit (404 otherwise). */
  private async doctorContext(
    tx: TenantTx,
    actor: Actor,
    visitId: string,
  ): Promise<{ own: string; visit: ClinicalVisitRow }> {
    const own = await ownDoctorId(tx, actor);
    if (!own) {
      throw clinicalError(403, E.DOCTOR_PROFILE_REQUIRED);
    }
    await lockVisit(tx, actor, visitId, own);
    return { own, visit: await findClinicalVisit(tx, actor, visitId, own) };
  }

  private requireInConsultation(visit: ClinicalVisitRow): void {
    if (visit.status !== 'IN_CONSULTATION') {
      throw clinicalError(409, E.VISIT_NOT_IN_CONSULTATION, { status: visit.status });
    }
  }

  async findNote(tx: TenantTx, actor: Actor, visitId: string) {
    return tx.consultation.findFirst({
      where: { tenantId: actor.tenantId, visitId },
      include: NOTE_INCLUDE,
    });
  }

  private async dayInfo(
    tx: TenantTx,
    actor: Actor,
  ): Promise<{ prefix: string; today: Date; startOfToday: Date }> {
    const settings = await tx.opdSettings.findUnique({ where: { tenantId: actor.tenantId } });
    const timeZone = settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone;
    const now = this.clock.now();
    const { hour, minute } = zonedParts(now, timeZone);
    // Zones differ from UTC by whole minutes, so seconds and milliseconds are the same everywhere.
    const sinceMidnightMs =
      (hour * 60 + minute) * 60_000 + now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
    return {
      prefix: settings?.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix,
      today: localDate(now, timeZone),
      startOfToday: new Date(now.getTime() - sinceMidnightMs),
    };
  }

  /** Follow-up date: a real calendar day, not before the visit day, within the allowed span. */
  private parseFollowUp(raw: string | undefined, visitDate: Date): Date | null {
    if (raw === undefined || raw === '') {
      return null;
    }
    const date = new Date(`${raw}T00:00:00.000Z`);
    const real = !Number.isNaN(date.getTime()) && isoDate(date) === raw;
    const days = (date.getTime() - visitDate.getTime()) / C.msPerDay;
    if (!real || days < 0 || days > C.followUpMaxDays) {
      throw clinicalError(400, E.FOLLOW_UP_DATE_INVALID);
    }
    return date;
  }

  /**
   * Checks every row (one of medicineId / medicineName, no blank text) and turns listed medicines
   * into a true copy of the hospital list (only ACTIVE medicines of THIS hospital).
   */
  private async resolvePrescription(tx: TenantTx, actor: Actor, items: PrescriptionItemDto[]) {
    const listedIds = [
      ...new Set(items.map((i) => i.medicineId).filter((id): id is string => id !== undefined)),
    ];
    const medicines = await tx.medicine.findMany({
      where: { tenantId: actor.tenantId, id: { in: listedIds }, active: true },
      select: { id: true, name: true },
    });
    const nameById = new Map(medicines.map((m) => [m.id, m.name]));
    return items.map((item, index) => {
      const dose = clean(item.dose);
      const frequency = clean(item.frequency);
      const duration = clean(item.duration);
      const typedName = clean(item.medicineName);
      const listed = item.medicineId !== undefined;
      if (
        dose === null ||
        frequency === null ||
        duration === null ||
        listed === (item.medicineName !== undefined) ||
        (!listed && typedName === null)
      ) {
        throw clinicalError(400, E.PRESCRIPTION_ITEM_INVALID, { index });
      }
      let medicineId: string | null = null;
      let medicineName = typedName ?? '';
      if (listed) {
        const name = nameById.get(item.medicineId!);
        if (name === undefined) {
          throw clinicalError(400, E.MEDICINE_NOT_FOUND, { index });
        }
        medicineId = item.medicineId!;
        medicineName = name;
      }
      return {
        medicineId,
        medicineName,
        isUnlisted: !listed,
        dose,
        frequency,
        duration,
        instructions: clean(item.instructions),
      };
    });
  }

  private async audit(
    tx: TenantTx,
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        branchId: actor.branchId,
        action,
        entityType,
        entityId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
