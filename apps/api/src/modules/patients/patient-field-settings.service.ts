import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { TenantDb } from '../../database/tenant-db';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import {
  isPatientFieldSection,
  patientFieldSectionRank,
  type PatientFieldSection,
} from './patient-field-sections';
import { codeFromLabel, REFERENCE_FIELD_SET } from './patient-reference-fields';

/** Limits of the "registration fields" settings screen. One place, no magic numbers. */
export const FIELD_SETTINGS_LIMITS = {
  maxCustomFields: 30,
  labelMax: 60,
  maxOptions: 50,
  optionLabelMax: 60,
  codeMax: 40,
} as const;

const DATA_TYPES = ['TEXT', 'NUMBER', 'DATE', 'DROPDOWN'] as const;
type DataType = (typeof DATA_TYPES)[number];

export const FieldReason = {
  REQUIRED: 'REQUIRED',
  INVALID: 'INVALID',
  TOO_LONG: 'TOO_LONG',
  TOO_MANY: 'TOO_MANY',
  DUPLICATE: 'DUPLICATE',
  LOCKED: 'LOCKED',
  NOT_A_DROPDOWN: 'NOT_A_DROPDOWN',
  NEEDS_AN_OPTION: 'NEEDS_AN_OPTION',
} as const;

type Actor = { tenantId: string; userId: string };

function refuse(field: string, reason: string): never {
  throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field, reason });
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function readLabel(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    refuse(field, FieldReason.REQUIRED);
  }
  const label = value.trim().replace(/\s+/g, ' ');
  if (label.length > max) {
    refuse(field, FieldReason.TOO_LONG);
  }
  return label;
}

function readBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    refuse(field, FieldReason.INVALID);
  }
  return value;
}

export { codeFromLabel };

export type BuiltinFieldRow = {
  key: string;
  label: string;
  section: string;
  dataType: string;
  isEnabled: boolean;
  isRequired: boolean;
  canDisable: boolean;
  alwaysRequired: boolean;
  sortOrder: number;
};

export type CustomFieldRow = {
  id: string;
  code: string;
  label: string;
  section: string;
  dataType: string;
  isEnabled: boolean;
  isRequired: boolean;
  sortOrder: number;
  options: Array<{ id: string; label: string; sortOrder: number; isActive: boolean }>;
};

@Injectable()
export class PatientFieldSettingsService {
  constructor(private readonly tenantDb: TenantDb) {}

  /** Every built-in field with its switches, and every custom field with its options. */
  async list(actor: Actor): Promise<{
    builtin: BuiltinFieldRow[];
    custom: CustomFieldRow[];
    limits: { maxCustomFields: number; labelMax: number; maxOptions: number };
  }> {
    return this.tenantDb.withTenant(async (tx) => {
      const catalog = await tx.patientFieldCatalog.findMany();
      const settings = await tx.patientFieldSetting.findMany({
        where: { tenantId: actor.tenantId },
      });
      const byKey = new Map(settings.filter((s) => s.catalogKey).map((s) => [s.catalogKey!, s]));
      const builtin: BuiltinFieldRow[] = catalog.map((c, index) => {
        const s = byKey.get(c.key);
        return {
          key: c.key,
          label: s?.label ?? c.defaultLabel,
          section: c.defaultSection,
          dataType: c.dataType,
          isEnabled: c.alwaysRequired ? true : (s?.isEnabled ?? true),
          isRequired: c.alwaysRequired ? true : (s?.isRequired ?? false),
          canDisable: c.canDisable,
          alwaysRequired: c.alwaysRequired,
          sortOrder: s?.sortOrder ?? index,
        };
      });
      builtin.sort(
        (a, b) =>
          patientFieldSectionRank(a.section) - patientFieldSectionRank(b.section) ||
          a.sortOrder - b.sortOrder,
      );
      const fields = await tx.patientCustomField.findMany({
        where: { tenantId: actor.tenantId },
        include: { options: { orderBy: { sortOrder: 'asc' } }, settings: true },
        orderBy: { createdAt: 'asc' },
      });
      const custom: CustomFieldRow[] = fields.map((f) => this.toCustomRow(f));
      return {
        builtin,
        custom,
        limits: {
          maxCustomFields: FIELD_SETTINGS_LIMITS.maxCustomFields,
          labelMax: FIELD_SETTINGS_LIMITS.labelMax,
          maxOptions: FIELD_SETTINGS_LIMITS.maxOptions,
        },
      };
    });
  }

  /** Turn a built-in field on or off, and make it required or optional. */
  async updateBuiltin(actor: Actor, key: string, body: unknown): Promise<BuiltinFieldRow> {
    if (!isRecord(body)) {
      refuse('body', FieldReason.REQUIRED);
    }
    const wantEnabled = readBoolean(body.isEnabled, 'isEnabled');
    const wantRequired = readBoolean(body.isRequired, 'isRequired');
    if (wantEnabled === undefined && wantRequired === undefined) {
      refuse('body', FieldReason.REQUIRED);
    }
    await this.tenantDb.withTenant(async (tx) => {
      const catalog = await tx.patientFieldCatalog.findUnique({ where: { key } });
      if (!catalog) {
        throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
      }
      const current = await tx.patientFieldSetting.findUnique({
        where: { tenantId_catalogKey: { tenantId: actor.tenantId, catalogKey: key } },
      });
      let isEnabled = wantEnabled ?? current?.isEnabled ?? true;
      let isRequired = wantRequired ?? current?.isRequired ?? false;
      if (catalog.alwaysRequired) {
        if (wantEnabled === false) refuse('isEnabled', FieldReason.LOCKED);
        if (wantRequired === false) refuse('isRequired', FieldReason.LOCKED);
        isEnabled = true;
        isRequired = true;
      }
      if (!catalog.canDisable && wantEnabled === false) {
        refuse('isEnabled', FieldReason.LOCKED);
      }
      if (!isEnabled) {
        isRequired = false; // a field that is off cannot be compulsory
      }
      await tx.patientFieldSetting.upsert({
        where: { tenantId_catalogKey: { tenantId: actor.tenantId, catalogKey: key } },
        create: {
          tenantId: actor.tenantId,
          catalogKey: key,
          isEnabled,
          isRequired,
          label: catalog.defaultLabel,
          sortOrder: 0,
          changedBy: actor.userId,
          changedAt: new Date(),
        },
        update: { isEnabled, isRequired, changedBy: actor.userId, changedAt: new Date() },
      });
      await this.audit(tx, actor, key, 'patient_field_settings', [
        ...(wantEnabled !== undefined ? ['isEnabled'] : []),
        ...(wantRequired !== undefined ? ['isRequired'] : []),
      ]);
    });
    const all = await this.list(actor);
    return all.builtin.find((b) => b.key === key)!;
  }

  /** Adds the hospital's own field to the registration form. Its type cannot change later. */
  async createCustom(actor: Actor, body: unknown): Promise<CustomFieldRow> {
    if (!isRecord(body)) {
      refuse('body', FieldReason.REQUIRED);
    }
    const label = readLabel(body.label, 'label', FIELD_SETTINGS_LIMITS.labelMax);
    const dataType = body.dataType as DataType;
    if (!DATA_TYPES.includes(dataType)) {
      refuse('dataType', body.dataType === undefined ? FieldReason.REQUIRED : FieldReason.INVALID);
    }
    const section = body.section ?? 'OTHER';
    if (typeof section !== 'string' || !isPatientFieldSection(section)) {
      refuse('section', FieldReason.INVALID);
    }
    const isRequired = readBoolean(body.isRequired, 'isRequired') ?? false;
    const optionLabels = this.readNewOptions(dataType, body.options);

    const id = await this.createWithoutClash(() =>
      this.tenantDb.withTenant(async (tx) => {
        const existing = await tx.patientCustomField.findMany({
          where: { tenantId: actor.tenantId },
          select: { code: true, label: true },
        });
        if (existing.length >= FIELD_SETTINGS_LIMITS.maxCustomFields) {
          refuse('label', FieldReason.TOO_MANY);
        }
        if (existing.some((e) => e.label.toLowerCase() === label.toLowerCase())) {
          refuse('label', FieldReason.DUPLICATE);
        }
        const base = codeFromLabel(label);
        const taken = new Set(existing.map((e) => e.code));
        let code = base;
        for (let n = 2; taken.has(code); n++) {
          code = `${base}_${n}`;
        }
        const top = await tx.patientFieldSetting.aggregate({
          where: { tenantId: actor.tenantId },
          _max: { sortOrder: true },
        });
        const created = await tx.patientCustomField.create({
          data: {
            tenantId: actor.tenantId,
            code,
            label,
            dataType,
            section,
          },
        });
        if (optionLabels.length > 0) {
          await tx.patientCustomFieldOption.createMany({
            data: optionLabels.map((text, index) => ({
              tenantId: actor.tenantId,
              fieldId: created.id,
              label: text,
              sortOrder: index,
            })),
          });
        }
        await tx.patientFieldSetting.create({
          data: {
            tenantId: actor.tenantId,
            customFieldId: created.id,
            isEnabled: true,
            isRequired,
            label,
            sortOrder: (top._max.sortOrder ?? 0) + 1,
            changedBy: actor.userId,
            changedAt: new Date(),
          },
        });
        await this.audit(tx, actor, code, 'patient_custom_fields', [
          'label',
          'dataType',
          'section',
          'isRequired',
          ...(optionLabels.length > 0 ? ['options'] : []),
        ]);
        return created.id;
      }),
    );
    return this.oneCustom(actor, id);
  }

  /**
   * Adds the ready-made reference fields (Referred by, Category, Organisation, Staff number) that
   * the hospital does not have yet. A field whose name is already used is left exactly as it is;
   * pressing it twice, or two Admins at the same moment, adds each field once.
   */
  async addReferenceSet(
    actor: Actor,
  ): Promise<{ created: string[]; kept: string[]; skipped: string[] }> {
    const created: string[] = [];
    const kept: string[] = [];
    const skipped: string[] = [];
    for (const def of REFERENCE_FIELD_SET) {
      try {
        await this.createCustom(actor, {
          label: def.label,
          dataType: def.dataType,
          section: def.section,
          ...(def.options ? { options: [...def.options] } : {}),
        });
        created.push(def.label);
      } catch (error) {
        const reason = (error as { response?: { reason?: string } }).response?.reason;
        if (reason === FieldReason.DUPLICATE) {
          kept.push(def.label);
        } else if (reason === FieldReason.TOO_MANY) {
          skipped.push(def.label);
        } else {
          throw error;
        }
      }
    }
    return { created, kept, skipped };
  }

  /** Renames, moves, turns off and on, or makes required. Never deletes: saved answers stay. */
  async updateCustom(actor: Actor, id: string, body: unknown): Promise<CustomFieldRow> {
    if (!isRecord(body)) {
      refuse('body', FieldReason.REQUIRED);
    }
    const label =
      body.label === undefined
        ? undefined
        : readLabel(body.label, 'label', FIELD_SETTINGS_LIMITS.labelMax);
    let section: PatientFieldSection | undefined;
    if (body.section !== undefined) {
      if (typeof body.section !== 'string' || !isPatientFieldSection(body.section)) {
        refuse('section', FieldReason.INVALID);
      }
      section = body.section;
    }
    const wantEnabled = readBoolean(body.isEnabled, 'isEnabled');
    const wantRequired = readBoolean(body.isRequired, 'isRequired');
    if (
      label === undefined &&
      section === undefined &&
      wantEnabled === undefined &&
      wantRequired === undefined
    ) {
      refuse('body', FieldReason.REQUIRED);
    }
    await this.tenantDb.withTenant(async (tx) => {
      const field = await tx.patientCustomField.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: { settings: true },
      });
      if (!field) {
        throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
      }
      if (label !== undefined) {
        const others = await tx.patientCustomField.findMany({
          where: { tenantId: actor.tenantId, NOT: { id } },
          select: { label: true },
        });
        if (others.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
          refuse('label', FieldReason.DUPLICATE);
        }
      }
      const setting = field.settings[0];
      const isEnabled = wantEnabled ?? setting?.isEnabled ?? true;
      const isRequired = isEnabled ? (wantRequired ?? setting?.isRequired ?? false) : false;
      await tx.patientCustomField.update({
        where: { id },
        data: { ...(label !== undefined ? { label } : {}), ...(section ? { section } : {}) },
      });
      await tx.patientFieldSetting.upsert({
        where: { tenantId_customFieldId: { tenantId: actor.tenantId, customFieldId: id } },
        create: {
          tenantId: actor.tenantId,
          customFieldId: id,
          isEnabled,
          isRequired,
          label: label ?? field.label,
          sortOrder: 0,
          changedBy: actor.userId,
          changedAt: new Date(),
        },
        update: {
          isEnabled,
          isRequired,
          ...(label !== undefined ? { label } : {}),
          changedBy: actor.userId,
          changedAt: new Date(),
        },
      });
      await this.audit(tx, actor, field.code, 'patient_custom_fields', [
        ...(label !== undefined ? ['label'] : []),
        ...(section ? ['section'] : []),
        ...(wantEnabled !== undefined ? ['isEnabled'] : []),
        ...(wantRequired !== undefined ? ['isRequired'] : []),
      ]);
    });
    return this.oneCustom(actor, id);
  }

  /**
   * Replaces the list of choices of a dropdown field. Listed choices with an id are renamed and
   * re-ordered; choices without an id are added; choices left out are switched off, never deleted
   * (patients may already have chosen them).
   */
  async replaceOptions(actor: Actor, id: string, body: unknown): Promise<CustomFieldRow> {
    if (!isRecord(body) || !Array.isArray(body.options)) {
      refuse('options', FieldReason.REQUIRED);
    }
    if (body.options.length > FIELD_SETTINGS_LIMITS.maxOptions) {
      refuse('options', FieldReason.TOO_MANY);
    }
    type Wanted = { id?: string; label: string; isActive: boolean };
    const wanted: Wanted[] = (body.options as unknown[]).map((raw, index) => {
      if (!isRecord(raw)) {
        refuse(`options.${index}`, FieldReason.INVALID);
      }
      if (raw.id !== undefined && typeof raw.id !== 'string') {
        refuse(`options.${index}.id`, FieldReason.INVALID);
      }
      const isActive = readBoolean(raw.isActive, `options.${index}.isActive`) ?? true;
      return {
        id: raw.id as string | undefined,
        label: readLabel(raw.label, `options.${index}.label`, FIELD_SETTINGS_LIMITS.optionLabelMax),
        isActive,
      };
    });
    const activeLabels = wanted.filter((w) => w.isActive).map((w) => w.label.toLowerCase());
    if (activeLabels.length === 0) {
      refuse('options', FieldReason.NEEDS_AN_OPTION);
    }
    if (new Set(activeLabels).size !== activeLabels.length) {
      refuse('options', FieldReason.DUPLICATE);
    }
    const ids = wanted.map((w) => w.id).filter((v): v is string => Boolean(v));
    if (new Set(ids).size !== ids.length) {
      refuse('options', FieldReason.DUPLICATE);
    }

    await this.tenantDb.withTenant(async (tx) => {
      const field = await tx.patientCustomField.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: { options: true },
      });
      if (!field) {
        throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
      }
      if (field.dataType !== 'DROPDOWN') {
        refuse('options', FieldReason.NOT_A_DROPDOWN);
      }
      const own = new Set(field.options.map((o) => o.id));
      wanted.forEach((w, index) => {
        if (w.id && !own.has(w.id)) {
          refuse(`options.${index}.id`, FieldReason.INVALID);
        }
      });
      const kept = new Set(ids);
      for (const o of field.options) {
        if (!kept.has(o.id) && o.isActive) {
          await tx.patientCustomFieldOption.update({
            where: { id: o.id },
            data: { isActive: false },
          });
        }
      }
      for (const [index, w] of wanted.entries()) {
        if (w.id) {
          await tx.patientCustomFieldOption.update({
            where: { id: w.id },
            data: { label: w.label, sortOrder: index, isActive: w.isActive },
          });
        } else {
          await tx.patientCustomFieldOption.create({
            data: {
              tenantId: actor.tenantId,
              fieldId: id,
              label: w.label,
              sortOrder: index,
              isActive: w.isActive,
            },
          });
        }
      }
      await this.audit(tx, actor, field.code, 'patient_custom_fields', ['options']);
    });
    return this.oneCustom(actor, id);
  }

  /**
   * Two administrators adding the same field at the same moment: the database refuses the second
   * (the code is unique), and that is the same answer as "this name is already used".
   */
  private async createWithoutClash<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        refuse('label', FieldReason.DUPLICATE);
      }
      throw error;
    }
  }

  private readNewOptions(dataType: DataType, raw: unknown): string[] {
    if (dataType !== 'DROPDOWN') {
      if (raw !== undefined) {
        refuse('options', FieldReason.INVALID);
      }
      return [];
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      refuse('options', FieldReason.NEEDS_AN_OPTION);
    }
    if (raw.length > FIELD_SETTINGS_LIMITS.maxOptions) {
      refuse('options', FieldReason.TOO_MANY);
    }
    const labels = raw.map((item, index) => {
      const source = isRecord(item) ? item.label : item;
      return readLabel(source, `options.${index}.label`, FIELD_SETTINGS_LIMITS.optionLabelMax);
    });
    if (new Set(labels.map((l) => l.toLowerCase())).size !== labels.length) {
      refuse('options', FieldReason.DUPLICATE);
    }
    return labels;
  }

  private async oneCustom(actor: Actor, id: string): Promise<CustomFieldRow> {
    const all = await this.list(actor);
    return all.custom.find((c) => c.id === id)!;
  }

  private toCustomRow(
    f: Prisma.PatientCustomFieldGetPayload<{ include: { options: true; settings: true } }>,
  ): CustomFieldRow {
    const s = f.settings[0];
    return {
      id: f.id,
      code: f.code,
      label: s?.label ?? f.label,
      section: f.section,
      dataType: f.dataType,
      isEnabled: s?.isEnabled ?? true,
      isRequired: s?.isRequired ?? false,
      sortOrder: s?.sortOrder ?? 0,
      options: f.options.map((o) => ({
        id: o.id,
        label: o.label,
        sortOrder: o.sortOrder,
        isActive: o.isActive,
      })),
    };
  }

  /** The audit trail keeps which settings changed, never what a patient typed. */
  private async audit(
    tx: Prisma.TransactionClient,
    actor: Actor,
    entityId: string,
    entityType: string,
    changed: string[],
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'PATIENT_FIELD_SETTING_CHANGE',
        entityType,
        entityId,
        reason: 'Registration field setting updated',
        metadata: { changed },
      },
    });
  }
}
