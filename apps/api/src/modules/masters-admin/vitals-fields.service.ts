import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb } from '../../database/tenant-db';
import { MASTERS_AUDIT, MASTERS_CONFIG as C } from './masters.config';
import {
  checkWarnPair,
  MasterRuleError,
  parseReorder,
  parseVitalsCreate,
  parseVitalsPatch,
} from './masters.rules';
import {
  auditMaster,
  conflict,
  lockMasters,
  notFound,
  num,
  parsed,
  type MasterActor,
} from './masters-support';

export type VitalsFieldView = {
  id: string;
  code: string;
  name: string;
  unit: string;
  valueKind: 'NUMBER' | 'TEXT';
  displayOrder: number;
  warnMin: number | null;
  warnMax: number | null;
  active: boolean;
  /** Readings recorded with it (a field is never deleted, only switched off). */
  readingsCount: number;
};

/**
 * Vitals fields of the hospital (Step 8c): add, switch off and on, order, and the usual range that
 * makes the nurse screen WARN (it never blocks a reading). The code and the kind (number or text)
 * never change. A reading keeps its own copy of the name, unit and kind, so editing a field never
 * rewrites what was recorded; the range is only used while typing and when showing a reading.
 */
@Injectable()
export class VitalsFieldsService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(actor: MasterActor): Promise<{ items: VitalsFieldView[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const fields = await tx.vitalsField.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ active: 'desc' }, { displayOrder: 'asc' }, { code: 'asc' }],
      });
      const counts = await tx.visitVitals.groupBy({
        by: ['vitalsFieldId'],
        where: { tenantId: actor.tenantId },
        _count: { _all: true },
      });
      const used = new Map(counts.map((c) => [c.vitalsFieldId, c._count._all]));
      return {
        items: fields.map((f) => ({
          id: f.id,
          code: f.code,
          name: f.name,
          unit: f.unit,
          valueKind: f.valueKind,
          displayOrder: f.displayOrder,
          warnMin: num(f.warnMin),
          warnMax: num(f.warnMax),
          active: f.active,
          readingsCount: used.get(f.id) ?? 0,
        })),
      };
    });
  }

  async create(actor: MasterActor, body: unknown): Promise<VitalsFieldView> {
    const input = parsed(() => parseVitalsCreate(body));
    const id = await this.tenantDb.withTenant(async (tx) => {
      await lockMasters(tx, actor.tenantId, this.clock.now());
      const all = await tx.vitalsField.findMany({
        where: { tenantId: actor.tenantId },
        select: { code: true, displayOrder: true },
      });
      if (all.length >= C.vitalsMax) {
        return conflict('TOO_MANY');
      }
      if (all.some((f) => f.code === input.code)) {
        return conflict('CODE_USED');
      }
      const created = await tx.vitalsField.create({
        data: {
          tenantId: actor.tenantId,
          code: input.code,
          name: input.name,
          unit: input.unit,
          valueKind: input.valueKind,
          warnMin: input.warnMin,
          warnMax: input.warnMax,
          displayOrder: Math.max(0, ...all.map((f) => f.displayOrder)) + 1,
        },
        select: { id: true },
      });
      await auditMaster(tx, actor, MASTERS_AUDIT.vitalsField, created.id, { kind: 'CREATE' });
      return created.id;
    });
    return this.one(actor, id);
  }

  async update(actor: MasterActor, id: string, body: unknown): Promise<VitalsFieldView> {
    const patch = parsed(() => parseVitalsPatch(body));
    await this.tenantDb.withTenant(async (tx) => {
      await lockMasters(tx, actor.tenantId, this.clock.now());
      const field = await tx.vitalsField.findFirst({ where: { id, tenantId: actor.tenantId } });
      if (!field) {
        return notFound();
      }
      const warnMin = patch.warnMin !== undefined ? patch.warnMin : num(field.warnMin);
      const warnMax = patch.warnMax !== undefined ? patch.warnMax : num(field.warnMax);
      if (field.valueKind === 'TEXT' && (warnMin !== null || warnMax !== null)) {
        parsed(() => {
          throw new MasterRuleError('warnMin', 'WARN_NEEDS_NUMBER');
        });
      }
      parsed(() => checkWarnPair(warnMin, warnMax));
      const changed: string[] = [];
      if (patch.name !== undefined && patch.name !== field.name) changed.push('name');
      if (patch.unit !== undefined && patch.unit !== field.unit) changed.push('unit');
      if (patch.warnMin !== undefined && patch.warnMin !== num(field.warnMin))
        changed.push('warnMin');
      if (patch.warnMax !== undefined && patch.warnMax !== num(field.warnMax))
        changed.push('warnMax');
      if (patch.active !== undefined && patch.active !== field.active) changed.push('active');
      if (changed.length === 0) {
        return undefined;
      }
      await tx.vitalsField.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.unit !== undefined ? { unit: patch.unit } : {}),
          ...(patch.warnMin !== undefined ? { warnMin: patch.warnMin } : {}),
          ...(patch.warnMax !== undefined ? { warnMax: patch.warnMax } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
        },
      });
      await auditMaster(tx, actor, MASTERS_AUDIT.vitalsField, id, { kind: 'UPDATE', changed });
      return undefined;
    });
    return this.one(actor, id);
  }

  /** Puts ALL the fields of the hospital in the given order (the list must be complete). */
  async reorder(actor: MasterActor, body: unknown): Promise<{ items: VitalsFieldView[] }> {
    const ids = parsed(() => parseReorder(body));
    await this.tenantDb.withTenant(async (tx) => {
      await lockMasters(tx, actor.tenantId, this.clock.now());
      const fields = await tx.vitalsField.findMany({
        where: { tenantId: actor.tenantId },
        select: { id: true, displayOrder: true },
      });
      const known = new Set(fields.map((f) => f.id));
      if (ids.length !== known.size || ids.some((i) => !known.has(i))) {
        return conflict('IDS_MISMATCH');
      }
      let moved = false;
      for (const [index, fieldId] of ids.entries()) {
        const order = index + 1;
        if (fields.find((f) => f.id === fieldId)!.displayOrder !== order) {
          await tx.vitalsField.update({ where: { id: fieldId }, data: { displayOrder: order } });
          moved = true;
        }
      }
      if (moved) {
        await auditMaster(tx, actor, MASTERS_AUDIT.vitalsField, ids[0]!, { kind: 'REORDER', ids });
      }
      return undefined;
    });
    return this.list(actor);
  }

  private async one(actor: MasterActor, id: string): Promise<VitalsFieldView> {
    const { items } = await this.list(actor);
    return items.find((f) => f.id === id) ?? notFound();
  }
}
