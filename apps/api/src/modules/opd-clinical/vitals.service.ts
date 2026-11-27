import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { OPD_SETTINGS_DEFAULTS } from '../opd-masters/opd-settings.defaults';
import { localDate, type Actor } from '../opd-visits/opd-visits.service';
import { findClinicalVisit, lockVisit, ownDoctorId, toVisitSummary } from './clinical-visit';
import type { RecordVitalsDto } from './dto/clinical.dto';
import { OPD_CLINICAL_AUDIT as AUDIT, OPD_CLINICAL_CONFIG as C } from './opd-clinical.config';
import { clinicalError, ClinicalErrorCode as E } from './opd-clinical.errors';

const toNumber = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));
const cents = (n: number): number => Math.round(n * 10 ** C.vitalsDecimals);
const NUMBER_TEXT = /^\d{1,8}(?:\.\d{1,2})?$/;

type Parsed = { number: number | null; text: string | null };

/**
 * Step 5a-3: vitals. Readings are append-only and versioned: the first reading of a field is
 * version 1; changing it later writes a NEW version with a reason (the old one stays). The field
 * name, unit and kind are copied at write time. A doctor works only on their own visits, a nurse
 * on any visit of the active branch; the visit must have joined the queue (be paid).
 */
@Injectable()
export class VitalsService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The active vitals fields (the screen is built from this, nothing is hardcoded). */
  async listFields(actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const fields = await tx.vitalsField.findMany({
        where: { tenantId: actor.tenantId, active: true },
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }],
      });
      return {
        items: fields.map((f) => ({
          code: f.code,
          name: f.name,
          unit: f.unit,
          valueKind: f.valueKind,
          displayOrder: f.displayOrder,
          warnMin: toNumber(f.warnMin),
          warnMax: toNumber(f.warnMax),
        })),
      };
    });
  }

  /** Current value and full history of every field recorded for one visit. */
  async getForVisit(visitId: string, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const own = await ownDoctorId(tx, actor);
      await findClinicalVisit(tx, actor, visitId, own);
      return this.viewInTx(tx, actor, visitId);
    });
  }

  /**
   * Records or corrects several readings in ONE transaction (all or nothing). A value equal to the
   * latest one changes nothing (a double click is harmless); a different value for a field that
   * already has a reading is a correction and needs a reason.
   */
  async record(visitId: string, body: RecordVitalsDto, actor: Actor) {
    return this.tenantDb.withTenant(async (tx) => {
      const own = await ownDoctorId(tx, actor);
      await lockVisit(tx, actor, visitId, own);
      const visit = await findClinicalVisit(tx, actor, visitId, own);
      // Phase 2.3: once the doctor has completed the consultation the vitals are locked too
      if (!['WAITING', 'IN_CONSULTATION'].includes(visit.status)) {
        throw clinicalError(409, E.VITALS_VISIT_NOT_OPEN, { status: visit.status });
      }

      const codes = body.readings.map((r) => r.fieldCode);
      if (new Set(codes).size !== codes.length) {
        throw clinicalError(400, E.VITALS_FIELD_DUPLICATE);
      }
      const fields = await tx.vitalsField.findMany({
        where: { tenantId: actor.tenantId, code: { in: codes }, active: true },
      });
      const byCode = new Map(fields.map((f) => [f.code, f]));

      const recorded: string[] = [];
      const corrected: string[] = [];
      const unchanged: string[] = [];
      for (const reading of body.readings) {
        const field = byCode.get(reading.fieldCode);
        if (!field) {
          throw clinicalError(400, E.VITALS_FIELD_NOT_FOUND, { fieldCode: reading.fieldCode });
        }
        const value = this.parseValue(reading.value, field.valueKind, field.code);
        const latest = await tx.visitVitals.findFirst({
          where: { tenantId: actor.tenantId, visitId, vitalsFieldId: field.id },
          orderBy: { version: 'desc' },
        });
        if (latest && this.sameValue(latest, value)) {
          unchanged.push(field.code);
          continue;
        }
        const reason = reading.correctionReason?.trim() ?? '';
        if (latest && reason === '') {
          throw clinicalError(400, E.VITALS_CORRECTION_REASON_REQUIRED, { fieldCode: field.code });
        }
        await tx.visitVitals.create({
          data: {
            tenantId: actor.tenantId,
            branchId: actor.branchId,
            visitId,
            vitalsFieldId: field.id,
            version: (latest?.version ?? 0) + 1,
            fieldCode: field.code,
            fieldName: field.name,
            unit: field.unit,
            valueKind: field.valueKind,
            valueNumber: value.number,
            valueText: value.text,
            correctionReason: latest ? reason : null,
            recordedBy: actor.userId,
          },
        });
        (latest ? corrected : recorded).push(field.code);
      }

      if (recorded.length + corrected.length > 0) {
        // Audit: field codes only (never the values).
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            branchId: actor.branchId,
            action: AUDIT.vitalsRecorded,
            entityType: 'opd_visit',
            entityId: visitId,
            metadata: { recorded, corrected },
          },
        });
      }
      return { recorded, corrected, unchanged, ...(await this.viewInTx(tx, actor, visitId)) };
    });
  }

  // -------------------------------------------------------------------------------- helpers

  private parseValue(raw: unknown, kind: 'NUMBER' | 'TEXT', fieldCode: string): Parsed {
    const invalid = () => clinicalError(400, E.VITALS_VALUE_INVALID, { fieldCode });
    if (kind === 'NUMBER') {
      const text =
        typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
      if (!NUMBER_TEXT.test(text)) {
        throw invalid();
      }
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0 || n > C.vitalsMaxAbsValue) {
        throw invalid();
      }
      return { number: n, text: null };
    }
    if (typeof raw !== 'string') {
      throw invalid();
    }
    const text = raw.trim();
    if (text === '' || text.length > C.vitalsTextMaxLength) {
      throw invalid();
    }
    return { number: null, text };
  }

  private sameValue(
    latest: { valueNumber: Prisma.Decimal | null; valueText: string | null },
    value: Parsed,
  ): boolean {
    if (value.number !== null) {
      return (
        latest.valueNumber !== null && cents(Number(latest.valueNumber)) === cents(value.number)
      );
    }
    return latest.valueText === value.text;
  }

  private async viewInTx(tx: TenantTx, actor: Actor, visitId: string) {
    const settings = await tx.opdSettings.findUnique({ where: { tenantId: actor.tenantId } });
    const today = localDate(this.clock.now(), settings?.timezone ?? OPD_SETTINGS_DEFAULTS.timezone);
    const [row, readings] = await Promise.all([
      findClinicalVisit(tx, actor, visitId, await ownDoctorId(tx, actor)),
      tx.visitVitals.findMany({
        where: { tenantId: actor.tenantId, visitId },
        orderBy: [{ version: 'asc' }, { createdAt: 'asc' }],
        include: {
          recorder: { select: { id: true, displayName: true } },
          field: { select: { displayOrder: true, warnMin: true, warnMax: true } },
        },
      }),
    ]);
    const byField = new Map<string, typeof readings>();
    for (const r of readings) {
      byField.set(r.vitalsFieldId, [...(byField.get(r.vitalsFieldId) ?? []), r]);
    }
    const fields = [...byField.values()]
      .map((history) => {
        const current = history[history.length - 1]!;
        const value =
          current.valueNumber !== null ? Number(current.valueNumber) : current.valueText;
        const min = toNumber(current.field.warnMin);
        const max = toNumber(current.field.warnMax);
        const n = current.valueNumber !== null ? Number(current.valueNumber) : null;
        return {
          order: current.field.displayOrder,
          code: current.fieldCode,
          name: current.fieldName,
          unit: current.unit,
          valueKind: current.valueKind,
          value,
          version: current.version,
          outOfRange: n !== null && ((min !== null && n < min) || (max !== null && n > max)),
          recordedAt: current.createdAt.toISOString(),
          recordedBy: { id: current.recorder.id, name: current.recorder.displayName },
          history: history.map((h) => ({
            version: h.version,
            value: h.valueNumber !== null ? Number(h.valueNumber) : h.valueText,
            correctionReason: h.correctionReason,
            recordedAt: h.createdAt.toISOString(),
            recordedBy: { id: h.recorder.id, name: h.recorder.displayName },
          })),
        };
      })
      .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
      .map(({ order: _order, ...rest }) => rest);
    return {
      visit: toVisitSummary(row, settings?.tokenPrefix ?? OPD_SETTINGS_DEFAULTS.tokenPrefix, today),
      fields,
    };
  }
}
