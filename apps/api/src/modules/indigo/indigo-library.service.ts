import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { HqPrismaService } from '../../database/hq-prisma.service';
import type { Prisma } from '../../generated/prisma';
import { IndigoAccessService } from '../auth/indigo-access.service';
import { ImageRefused, sniffImage } from '../images/image-sniff';
import {
  PRESETS,
  PRINT_DOC_TYPES,
  presetInput,
  validateTemplate,
  type PrintDocType,
  type PrintTemplateInput,
} from '../print-templates/print-template.rules';
import { sampleTemplates } from '../print-templates/sample-templates';

function invalid(field: string, reason: string): never {
  throw new HttpException({ statusCode: 400, code: 'INDIGO_INVALID', field, reason }, 400);
}
function conflict(field: string, reason: string): never {
  throw new HttpException({ statusCode: 409, code: 'INDIGO_CONFLICT', field, reason }, 409);
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const LIBRARY_LIMITS = { nameMax: 80, descriptionMax: 200, logoMaxBytes: 524_288 } as const;

/**
 * Step 2.1f: the Indigo template library. The Owner adds designed templates (the built-in samples, a
 * copy of an existing one, or a starting preset) and logos, and assigns them to hospitals; a hospital
 * then only CHOOSES among what is assigned to it. Every change is audited in the hospital it touches.
 * Employees have no access here (403); hospital users have the wrong token kind (401).
 */
@Injectable()
export class IndigoLibraryService {
  constructor(
    private readonly hq: HqPrismaService,
    private readonly access: IndigoAccessService,
  ) {}

  private async requireOwner(hqUserId: string): Promise<void> {
    const person = await this.hq.hqUser.findUnique({
      where: { id: hqUserId },
      select: { isActive: true, indigoRole: true },
    });
    if (!person?.isActive || person.indigoRole !== 'OWNER') {
      throw new ForbiddenException();
    }
  }

  private async audit(
    tenantId: string,
    hqUserId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.hq.auditLog.createMany({
      data: [
        {
          tenantId,
          actorUserId: null,
          action,
          entityType: 'print_library',
          entityId,
          metadata: { hqUserId, ...metadata } as object,
        },
      ],
    });
  }

  async overview(hqUserId: string) {
    await this.requireOwner(hqUserId);
    const [templates, logos, assignments] = await Promise.all([
      this.hq.printLibraryTemplate.findMany({ orderBy: [{ docType: 'asc' }, { name: 'asc' }] }),
      this.hq.printLibraryLogo.findMany({
        select: { id: true, name: true, width: true, height: true },
        orderBy: { name: 'asc' },
      }),
      this.hq.printLibraryAssignment.findMany({
        select: { tenantId: true, templateId: true, logoId: true },
      }),
    ]);
    const have = new Set(templates.map((t) => t.key));
    return {
      templates: templates.map((t) => ({
        id: t.id,
        docType: t.docType,
        key: t.key,
        name: t.name,
        description: t.description,
        paper: (t.input as { paper?: string }).paper ?? '',
        retired: t.retiredAt !== null,
        hospitalIds: assignments.filter((a) => a.templateId === t.id).map((a) => a.tenantId),
      })),
      logos: logos.map((l) => ({
        ...l,
        hospitalIds: assignments.filter((a) => a.logoId === l.id).map((a) => a.tenantId),
      })),
      samplesMissing: sampleTemplates().filter((s) => !have.has(s.key)).length,
    };
  }

  /** Adds the built-in designed samples that are not in the library yet (safe to press twice). */
  async addSamples(hqUserId: string): Promise<{ added: number }> {
    await this.requireOwner(hqUserId);
    const have = new Set(
      (await this.hq.printLibraryTemplate.findMany({ select: { key: true } })).map((t) => t.key),
    );
    let added = 0;
    for (const sample of sampleTemplates()) {
      if (have.has(sample.key)) {
        continue;
      }
      await this.hq.printLibraryTemplate.createMany({
        data: [
          {
            docType: sample.docType,
            key: sample.key,
            name: sample.name,
            description: sample.description,
            input: sample.input as unknown as Prisma.InputJsonValue,
            createdBy: hqUserId,
          },
        ],
        skipDuplicates: true,
      });
      added += 1;
    }
    return { added };
  }

  /**
   * A new library template: a copy of an existing one (copyOf) or the start of a preset, under a new
   * name. The result goes through the same checks as any saved template.
   */
  async createTemplate(hqUserId: string, body: unknown) {
    await this.requireOwner(hqUserId);
    if (!isObject(body)) {
      invalid('body', 'REQUIRED');
    }
    const allowed = ['docType', 'name', 'description', 'copyOf', 'preset'];
    for (const key of Object.keys(body)) {
      if (!allowed.includes(key)) {
        invalid(key, 'UNKNOWN_FIELD');
      }
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > LIBRARY_LIMITS.nameMax) {
      invalid('name', 'INVALID');
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > LIBRARY_LIMITS.descriptionMax) {
      invalid('description', 'TOO_LONG');
    }
    let docType: PrintDocType;
    let input: PrintTemplateInput;
    if (typeof body.copyOf === 'string') {
      const source = await this.hq.printLibraryTemplate.findUnique({ where: { id: body.copyOf } });
      if (!source) {
        invalid('copyOf', 'NOT_FOUND');
      }
      docType = source.docType as PrintDocType;
      input = validateTemplate(docType, source.input);
    } else {
      if (
        typeof body.docType !== 'string' ||
        !(PRINT_DOC_TYPES as readonly string[]).includes(body.docType)
      ) {
        invalid('docType', 'INVALID');
      }
      docType = body.docType as PrintDocType;
      const preset = typeof body.preset === 'string' ? body.preset : 'A5_FULL';
      if (!(preset in PRESETS)) {
        invalid('preset', 'UNKNOWN_PRESET');
      }
      input = presetInput(preset, docType);
    }
    const key = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const row = await this.hq.printLibraryTemplate.create({
        data: {
          docType,
          key,
          name,
          description,
          input: input as unknown as Prisma.InputJsonValue,
          createdBy: hqUserId,
        },
        select: { id: true },
      });
      return { id: row.id };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        conflict('name', 'TAKEN');
      }
      throw error;
    }
  }

  async retireTemplate(hqUserId: string, id: string): Promise<{ ok: true }> {
    await this.requireOwner(hqUserId);
    const done = await this.hq.printLibraryTemplate.updateMany({
      where: { id, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    if (done.count === 0) {
      invalid('id', 'NOT_FOUND');
    }
    return { ok: true };
  }

  async addLogo(hqUserId: string, name: unknown, bytes: Buffer | undefined) {
    await this.requireOwner(hqUserId);
    const clean = typeof name === 'string' ? name.trim() : '';
    if (clean.length < 1 || clean.length > LIBRARY_LIMITS.nameMax) {
      invalid('name', 'INVALID');
    }
    if (!bytes || bytes.length === 0) {
      invalid('file', 'REQUIRED');
    }
    if (bytes.length > LIBRARY_LIMITS.logoMaxBytes) {
      invalid('file', 'TOO_BIG');
    }
    let sniffed;
    try {
      sniffed = sniffImage(bytes);
    } catch (error) {
      if (error instanceof ImageRefused) {
        invalid('file', error.reason);
      }
      throw error;
    }
    if (sniffed.contentType !== 'image/png' && sniffed.contentType !== 'image/jpeg') {
      invalid('file', 'TYPE_NOT_ALLOWED');
    }
    try {
      const row = await this.hq.printLibraryLogo.create({
        data: {
          name: clean,
          contentType: sniffed.contentType,
          byteSize: bytes.length,
          width: sniffed.width,
          height: sniffed.height,
          data: new Uint8Array(bytes),
          createdBy: hqUserId,
        },
        select: { id: true },
      });
      return { id: row.id };
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        conflict('name', 'TAKEN');
      }
      throw error;
    }
  }

  async logoImage(hqUserId: string, id: string) {
    await this.requireOwner(hqUserId);
    const logo = await this.hq.printLibraryLogo.findUnique({ where: { id } });
    if (!logo) {
      invalid('id', 'NOT_FOUND');
    }
    return { contentType: logo.contentType, data: Buffer.from(logo.data) };
  }

  /** Replaces what one hospital may choose from. */
  async assign(hqUserId: string, hospitalId: string, body: unknown) {
    await this.requireOwner(hqUserId);
    if (
      !isObject(body) ||
      !Array.isArray(body.templateIds) ||
      !Array.isArray(body.logoIds) ||
      Object.keys(body).some((k) => k !== 'templateIds' && k !== 'logoIds')
    ) {
      invalid('body', 'INVALID');
    }
    const templateIds = [...new Set(body.templateIds.map(String))];
    const logoIds = [...new Set(body.logoIds.map(String))];
    const hospital = await this.hq.hospital.findUnique({
      where: { id: hospitalId },
      select: { id: true },
    });
    if (!hospital) {
      throw new ForbiddenException();
    }
    const [okTemplates, okLogos] = await Promise.all([
      this.hq.printLibraryTemplate.count({ where: { id: { in: templateIds }, retiredAt: null } }),
      this.hq.printLibraryLogo.count({ where: { id: { in: logoIds } } }),
    ]);
    if (okTemplates !== templateIds.length) {
      invalid('templateIds', 'UNKNOWN');
    }
    if (okLogos !== logoIds.length) {
      invalid('logoIds', 'UNKNOWN');
    }
    const current = await this.hq.printLibraryAssignment.findMany({
      where: { tenantId: hospitalId },
      select: { id: true, templateId: true, logoId: true },
    });
    const keep = new Set([...templateIds, ...logoIds]);
    const drop = current.filter((a) => !keep.has((a.templateId ?? a.logoId) as string));
    const have = new Set(current.map((a) => (a.templateId ?? a.logoId) as string));
    if (drop.length > 0) {
      await this.hq.printLibraryAssignment.deleteMany({
        where: { id: { in: drop.map((a) => a.id) }, tenantId: hospitalId },
      });
    }
    const add = [
      ...templateIds
        .filter((id) => !have.has(id))
        .map((id) => ({ tenantId: hospitalId, templateId: id })),
      ...logoIds.filter((id) => !have.has(id)).map((id) => ({ tenantId: hospitalId, logoId: id })),
    ];
    if (add.length > 0) {
      await this.hq.printLibraryAssignment.createMany({ data: add, skipDuplicates: true });
    }
    await this.audit(hospitalId, hqUserId, 'INDIGO_LIBRARY_ASSIGN', hospitalId, {
      templates: templateIds.length,
      logos: logoIds.length,
    });
    return { templateIds, logoIds };
  }

  /** What one hospital may choose from (for the assign screen). */
  async assignedTo(hqUserId: string, hospitalId: string) {
    await this.requireOwner(hqUserId);
    const rows = await this.hq.printLibraryAssignment.findMany({
      where: { tenantId: hospitalId },
      select: { templateId: true, logoId: true },
    });
    return {
      templateIds: rows.flatMap((r) => (r.templateId ? [r.templateId] : [])),
      logoIds: rows.flatMap((r) => (r.logoId ? [r.logoId] : [])),
    };
  }

  /** Employees may not use the library; kept so the controller has one place for the hospital check. */
  hospitals(hqUserId: string) {
    return this.access.hospitals(hqUserId);
  }
}
