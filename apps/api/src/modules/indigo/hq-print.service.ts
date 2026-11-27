import { randomUUID } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable } from '@nestjs/common';
import { runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { TenantDb } from '../../database/tenant-db';
import type { Prisma } from '../../generated/prisma';
import { ImagesService } from '../images/images.service';
import {
  PRINT_DOC_TYPES,
  validateTemplate,
  type PrintDocType,
} from '../print-templates/print-template.rules';
import { effective, PrintTemplatesService } from '../print-templates/print-templates.service';
import { HqPermissionsService } from './hq-permissions.service';
import { HqScopeService } from './hq-scope.service';

function invalid(field: string, reason: string): never {
  throw new HttpException({ statusCode: 400, code: 'INDIGO_INVALID', field, reason }, 400);
}
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Phase 2.2: HQ sets the ACTIVE design and logo of a hospital, and edits the library templates in the
 * designer, without ever entering the hospital. Writes into the hospital go through the tenant door
 * (row level security still applies) with the hospital's Super Admin as the technical owner of the row;
 * the audit entry and the HQ activity log name the HQ person. HQ Staff need the "print designs" tick
 * and the hospital in their assignment.
 */
@Injectable()
export class HqPrintService {
  constructor(
    private readonly hq: HqPrismaService,
    private readonly tenantDb: TenantDb,
    private readonly perms: HqPermissionsService,
    private readonly access: HqScopeService,
    private readonly templates: PrintTemplatesService,
    private readonly images: ImagesService,
  ) {}

  private async need(hqUserId: string, hospitalId?: string): Promise<void> {
    await this.perms.require(hqUserId, 'hq.print');
    if (hospitalId !== undefined) {
      const visible = await this.access.hospitals(hqUserId);
      if (!visible.some((h) => h.id === hospitalId)) {
        throw new ForbiddenException();
      }
    }
  }

  /** The hospital's technical user (an active Super Admin) and its main branch, for the tenant door. */
  private async door(hospitalId: string): Promise<{ userId: string; branchId: string }> {
    const admins = await this.hq.$queryRaw<
      Array<{ id: string; is_active: boolean }>
    >`SELECT id, is_active FROM hq_list_superadmins(${hospitalId})`;
    const admin = admins.find((a) => a.is_active);
    const main = await this.hq.branch.findFirst({
      where: { tenantId: hospitalId, isActive: true },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { id: true },
    });
    if (!admin || !main) {
      throw new HttpException(
        { statusCode: 409, code: 'INDIGO_CONFLICT', field: 'superAdmin', reason: 'NONE' },
        409,
      );
    }
    return { userId: admin.id, branchId: main.id };
  }

  private inHospital<T>(hospitalId: string, branchId: string, fn: () => Promise<T>): Promise<T> {
    return runWithContext(
      {
        tenantId: hospitalId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: branchId,
        requestId: randomUUID(),
      },
      fn,
    );
  }

  /** Which design is active for each document of a hospital, and whether it has a logo. */
  async active(hqUserId: string, hospitalId: string) {
    await this.need(hqUserId, hospitalId);
    const main = await this.hq.branch.findFirst({
      where: { tenantId: hospitalId, isActive: true },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      select: { id: true },
    });
    if (!main) {
      return { designs: [], hasLogo: false };
    }
    return this.inHospital(hospitalId, main.id, () =>
      this.tenantDb.withTenant(async (tx) => {
        const rows = await tx.printTemplate.findMany({
          where: { tenantId: hospitalId, retiredAt: null },
          select: { docType: true, branchId: true, libraryTemplateId: true },
        });
        const logo = await tx.storedImage.count({
          where: { tenantId: hospitalId, purpose: 'HOSPITAL_LOGO', isCurrent: true },
        });
        return {
          designs: rows.map((r) => ({
            docType: r.docType,
            branchId: r.branchId,
            libraryTemplateId: r.libraryTemplateId,
          })),
          hasLogo: logo > 0,
        };
      }),
    );
  }

  /** Makes one library design the active one for the whole hospital, or for one branch of it. */
  async activateDesign(hqUserId: string, hospitalId: string, body: unknown) {
    await this.need(hqUserId, hospitalId);
    if (!isObject(body) || Object.keys(body).some((k) => !['templateId', 'branchId'].includes(k))) {
      invalid('body', 'INVALID');
    }
    if (typeof body.templateId !== 'string') {
      invalid('templateId', 'REQUIRED');
    }
    const row = await this.hq.printLibraryTemplate.findFirst({
      where: { id: body.templateId, retiredAt: null },
    });
    if (!row) {
      invalid('templateId', 'NOT_FOUND');
    }
    const door = await this.door(hospitalId);
    let branchId = door.branchId;
    let scope: 'hospital' | 'branch' = 'hospital';
    if (body.branchId !== undefined && body.branchId !== null) {
      const branch =
        typeof body.branchId === 'string'
          ? await this.hq.branch.findFirst({
              where: { id: body.branchId, tenantId: hospitalId, isActive: true },
              select: { id: true },
            })
          : null;
      if (!branch) {
        invalid('branchId', 'NOT_FOUND');
      }
      branchId = branch.id;
      scope = 'branch';
    }
    const docType = row.docType as PrintDocType;
    // the hospital may switch among what HQ gave it: make sure this one is on its list
    await this.hq.printLibraryAssignment.createMany({
      data: [{ tenantId: hospitalId, templateId: row.id }],
      skipDuplicates: true,
    });
    await this.inHospital(hospitalId, branchId, () =>
      this.templates.saveForHq(
        { tenantId: hospitalId, userId: door.userId, branchId },
        docType,
        row.input as never,
        scope,
        row.id,
        hqUserId,
      ),
    );
    await this.perms.activity(
      hqUserId,
      hospitalId,
      'HQ_PRINT_DESIGN_SET',
      'print_template',
      docType,
      {
        docType,
        scope,
        library: row.name,
      },
    );
    return { docType, scope };
  }

  /** Makes one library logo the hospital's current logo. */
  async setLogo(hqUserId: string, hospitalId: string, body: unknown) {
    await this.need(hqUserId, hospitalId);
    if (!isObject(body) || Object.keys(body).some((k) => k !== 'logoId')) {
      invalid('body', 'INVALID');
    }
    if (typeof body.logoId !== 'string') {
      invalid('logoId', 'REQUIRED');
    }
    const logo = await this.hq.printLibraryLogo.findUnique({ where: { id: body.logoId } });
    if (!logo) {
      invalid('logoId', 'NOT_FOUND');
    }
    const door = await this.door(hospitalId);
    await this.hq.printLibraryAssignment.createMany({
      data: [{ tenantId: hospitalId, logoId: logo.id }],
      skipDuplicates: true,
    });
    await this.inHospital(hospitalId, door.branchId, () =>
      this.images.replace(
        { tenantId: hospitalId, userId: door.userId },
        { purpose: 'HOSPITAL_LOGO', doctorProfileId: null },
        Buffer.from(logo.data),
      ),
    );
    await this.perms.activity(hqUserId, hospitalId, 'HQ_LOGO_SET', 'stored_image', null, {
      logo: logo.name,
    });
    return { ok: true as const };
  }

  // ----------------------------------------------------------------------------- the designer

  /** One library template in the shape the designer screen loads (checked and complete). */
  async libraryTemplate(hqUserId: string, id: string) {
    await this.need(hqUserId);
    const row = await this.hq.printLibraryTemplate.findUnique({ where: { id } });
    if (!row || row.retiredAt) {
      invalid('id', 'NOT_FOUND');
    }
    const docType = row.docType as PrintDocType;
    const input = validateTemplate(docType, row.input);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      template: effective(docType, input, 'HOSPITAL', null),
    };
  }

  /** The designer saves its changes into the library template (the same checks as any template). */
  async saveLibraryTemplate(hqUserId: string, id: string, body: unknown) {
    await this.need(hqUserId);
    const row = await this.hq.printLibraryTemplate.findUnique({ where: { id } });
    if (!row || row.retiredAt) {
      invalid('id', 'NOT_FOUND');
    }
    const docType = row.docType as PrintDocType;
    if (!(PRINT_DOC_TYPES as readonly string[]).includes(docType)) {
      invalid('docType', 'INVALID');
    }
    const input = validateTemplate(docType, body);
    await this.hq.printLibraryTemplate.update({
      where: { id },
      data: { input: input as unknown as Prisma.InputJsonValue },
    });
    await this.perms.activity(hqUserId, null, 'HQ_LIBRARY_TEMPLATE_SAVE', 'print_library', id, {
      template: row.name,
      docType,
    });
    return effective(docType, input, 'HOSPITAL', null);
  }
}
