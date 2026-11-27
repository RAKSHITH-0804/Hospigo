import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { ImagesService } from '../images/images.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import type { Actor } from '../opd-visits/opd-visits.service';
import { PRINT_DOC_TYPES, validateTemplate, type PrintDocType } from './print-template.rules';
import type { PrintScope } from './print-scope';
import {
  effective,
  PrintTemplatesService,
  type EffectiveTemplate,
} from './print-templates.service';

export type LibraryView = {
  /** What the caller may do here: choose for this branch, and for the whole hospital. */
  canChoose: { branch: boolean; hospital: boolean };
  templates: Array<{
    id: string;
    docType: PrintDocType;
    name: string;
    description: string;
    paper: string;
    /** True for the template that applies to the signed-in branch for its document. */
    active: boolean;
  }>;
  logos: Array<{ id: string; name: string; width: number; height: number }>;
};

/**
 * Step 2.1f: the template library as a hospital sees it. Indigo owns the designs and assigns some of
 * them to a hospital; a SuperAdmin (the whole hospital) or an Admin (the own branch) CHOOSES one per
 * document, and a SuperAdmin chooses the logo. Choosing copies the design into the hospital's own
 * templates (so the print screens, which only know hospital templates, keep working) and remembers
 * which library entry it came from. The database shows the hospital login only what is assigned to
 * it (row level security), and only Indigo writes the library.
 */
@Injectable()
export class PrintLibraryService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    private readonly templates: PrintTemplatesService,
    private readonly images: ImagesService,
  ) {}

  async list(actor: Actor): Promise<LibraryView> {
    const [branch, hospital] = await Promise.all([
      this.access.can('print.templates.choose', actor.branchId, 'OPD'),
      this.access
        .hospitalWideBranches('print.templates.choose', 'OPD')
        .then((branches) => branches.length > 0),
    ]);
    return this.tenantDb.withTenant(async (tx) => {
      const [templates, logos, chosen] = await Promise.all([
        tx.printLibraryTemplate.findMany({
          where: { retiredAt: null },
          orderBy: [{ docType: 'asc' }, { name: 'asc' }],
        }),
        tx.printLibraryLogo.findMany({
          select: { id: true, name: true, width: true, height: true },
          orderBy: { name: 'asc' },
        }),
        tx.printTemplate.findMany({
          where: {
            tenantId: actor.tenantId,
            retiredAt: null,
            OR: [{ branchId: null }, { branchId: actor.branchId }],
          },
          select: { docType: true, branchId: true, libraryTemplateId: true },
        }),
      ]);
      // what applies to this branch: its own template, else the hospital's
      const activeIds = new Set<string>();
      for (const docType of PRINT_DOC_TYPES) {
        const own = chosen.find((r) => r.docType === docType && r.branchId === actor.branchId);
        const wide = chosen.find((r) => r.docType === docType && r.branchId === null);
        const id = (own ?? wide)?.libraryTemplateId;
        if (id) {
          activeIds.add(id);
        }
      }
      return {
        canChoose: { branch, hospital },
        templates: templates.map((t) => ({
          id: t.id,
          docType: t.docType as PrintDocType,
          name: t.name,
          description: t.description,
          paper: (t.input as { paper?: string }).paper ?? '',
          active: activeIds.has(t.id),
        })),
        logos,
      };
    });
  }

  /**
   * One assigned design as the print screens know it, to LOOK at before choosing it (Phase 2.3). The
   * database shows the hospital login only what is assigned to it, so any other id is "not found".
   */
  async viewTemplate(id: string): Promise<EffectiveTemplate> {
    const row = await this.tenantDb.withTenant((tx) =>
      tx.printLibraryTemplate.findFirst({ where: { id, retiredAt: null } }),
    );
    if (!row) {
      throw opdError(404, OpdErrorCode.LIBRARY_ITEM_NOT_FOUND);
    }
    const docType = row.docType as PrintDocType;
    return effective(docType, validateTemplate(docType, row.input), 'HOSPITAL', null);
  }

  async chooseTemplate(actor: Actor, id: string, scope: PrintScope): Promise<EffectiveTemplate> {
    const row = await this.tenantDb.withTenant((tx) =>
      tx.printLibraryTemplate.findFirst({ where: { id, retiredAt: null } }),
    );
    // not assigned to this hospital (or retired): the same answer as an unknown id
    if (!row) {
      throw opdError(404, OpdErrorCode.LIBRARY_ITEM_NOT_FOUND);
    }
    return this.templates.saveWithRetry(actor, row.docType as PrintDocType, row.input, scope, {
      libraryTemplateId: row.id,
    });
  }

  async chooseLogo(actor: Actor, id: string): Promise<{ id: string }> {
    if ((await this.access.hospitalWideBranches('print.templates.choose', 'OPD')).length === 0) {
      throw opdError(403, OpdErrorCode.PRINT_SCOPE_FORBIDDEN);
    }
    const logo = await this.tenantDb.withTenant((tx) =>
      tx.printLibraryLogo.findFirst({ where: { id } }),
    );
    if (!logo) {
      throw opdError(404, OpdErrorCode.LIBRARY_ITEM_NOT_FOUND);
    }
    const meta = await this.images.replace(
      actor,
      { purpose: 'HOSPITAL_LOGO', doctorProfileId: null },
      Buffer.from(logo.data),
    );
    return { id: meta.id };
  }

  /** The picture of an assigned logo (for the thumbnail in the chooser). */
  async logoImage(actor: Actor, id: string): Promise<{ contentType: string; data: Buffer }> {
    void actor;
    const logo = await this.tenantDb.withTenant((tx) =>
      tx.printLibraryLogo.findFirst({ where: { id } }),
    );
    if (!logo) {
      throw opdError(404, OpdErrorCode.LIBRARY_ITEM_NOT_FOUND);
    }
    return { contentType: logo.contentType, data: Buffer.from(logo.data) };
  }
}
