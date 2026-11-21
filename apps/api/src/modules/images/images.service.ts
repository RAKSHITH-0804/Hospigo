import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { STORAGE_SERVICE, StorageService } from '../storage/storage.service';
import { ImageRefused, sniffImage } from './image-sniff';
import { IMAGE_LIMITS, IMAGE_TYPES, type ImagePurpose } from './images.config';

type Actor = { tenantId: string; userId: string };

/** What the screens may know about a picture (never the storage key or the hash). */
export type ImageMeta = {
  id: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: string;
};

export type ImageLimitsView = {
  maxBytes: number;
  maxSidePx: number;
  minSidePx: number;
  types: readonly string[];
};

export const imageLimitsView = (): ImageLimitsView => ({
  maxBytes: IMAGE_LIMITS.maxBytes,
  maxSidePx: IMAGE_LIMITS.maxSidePx,
  minSidePx: IMAGE_LIMITS.minSidePx,
  types: IMAGE_TYPES,
});

type Row = {
  id: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
  createdAt: Date;
};

const toMeta = (row: Row): ImageMeta => ({
  id: row.id,
  contentType: row.contentType,
  byteSize: row.byteSize,
  width: row.width,
  height: row.height,
  createdAt: row.createdAt.toISOString(),
});

const PICTURE_SELECT = {
  id: true,
  contentType: true,
  byteSize: true,
  width: true,
  height: true,
  createdAt: true,
} as const;

/**
 * Pictures of a hospital: the logo and the doctors' signature or stamp. The bytes go to object
 * storage under the hospital's own prefix; the database keeps what the file is. A new picture
 * becomes the current one and the old one stays on record (a completed prescription keeps pointing
 * at the signature it was signed with). The file itself is looked at (type, whole, size), never
 * trusted by name. Nothing is ever deleted.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  /** The current picture of a place (the logo, or one doctor's signature), or null. */
  async current(
    tx: TenantTx,
    tenantId: string,
    purpose: ImagePurpose,
    doctorProfileId: string | null,
  ): Promise<ImageMeta | null> {
    const row = await tx.storedImage.findFirst({
      where: { tenantId, purpose, doctorProfileId, isCurrent: true },
      select: PICTURE_SELECT,
    });
    return row ? toMeta(row) : null;
  }

  /** Current signature pictures of many doctors at once (the Admin list). */
  async currentSignatures(
    tx: TenantTx,
    tenantId: string,
    doctorProfileIds: string[],
  ): Promise<Map<string, ImageMeta>> {
    if (doctorProfileIds.length === 0) {
      return new Map();
    }
    const rows = await tx.storedImage.findMany({
      where: {
        tenantId,
        purpose: 'DOCTOR_SIGNATURE',
        isCurrent: true,
        doctorProfileId: { in: doctorProfileIds },
      },
      select: { ...PICTURE_SELECT, doctorProfileId: true },
    });
    return new Map(rows.map((r) => [r.doctorProfileId!, toMeta(r)]));
  }

  /** Checks the bytes of an upload; a refusal is `400 SETTINGS_INVALID { field: 'file', reason }`. */
  inspect(bytes: Buffer | undefined) {
    if (!bytes) {
      throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field: 'file', reason: 'REQUIRED' });
    }
    try {
      return sniffImage(bytes);
    } catch (error) {
      if (error instanceof ImageRefused) {
        throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field: 'file', reason: error.reason });
      }
      throw error;
    }
  }

  /** Stores the picture and makes it the current one of its place. */
  async replace(
    actor: Actor,
    place: { purpose: ImagePurpose; doctorProfileId: string | null },
    bytes: Buffer | undefined,
  ): Promise<ImageMeta> {
    const sniffed = this.inspect(bytes);
    const data = bytes!;
    const id = randomUUID();
    const key = `images/${id}`;
    await this.storage.put(actor.tenantId, key, data);
    try {
      return await this.tenantDb.withTenant(async (tx) => {
        await tx.storedImage.updateMany({
          where: {
            tenantId: actor.tenantId,
            purpose: place.purpose,
            doctorProfileId: place.doctorProfileId,
            isCurrent: true,
          },
          data: { isCurrent: false },
        });
        const row = await tx.storedImage.create({
          data: {
            id,
            tenantId: actor.tenantId,
            purpose: place.purpose,
            doctorProfileId: place.doctorProfileId,
            contentType: sniffed.contentType,
            byteSize: data.length,
            width: sniffed.width,
            height: sniffed.height,
            sha256: createHash('sha256').update(data).digest('hex'),
            storageKey: key,
            createdBy: actor.userId,
          },
          select: PICTURE_SELECT,
        });
        await this.audit(tx, actor, place, 'replace');
        return toMeta(row);
      });
    } catch (error) {
      // nothing points at the file: take it away again so no orphan stays behind
      await this.storage.delete(actor.tenantId, key).catch((e: Error) => {
        this.logger.warn(`Could not remove an unused picture file: ${e.message}`);
      });
      if ((error as { code?: string }).code === 'P2002') {
        throw opdError(409, OpdErrorCode.STAFF_CONFLICT, { reason: 'TRY_AGAIN' });
      }
      throw error;
    }
  }

  /** The place has no picture any more; the old one stays on record. */
  async removeCurrent(
    actor: Actor,
    place: { purpose: ImagePurpose; doctorProfileId: string | null },
  ): Promise<void> {
    await this.tenantDb.withTenant(async (tx) => {
      const result = await tx.storedImage.updateMany({
        where: {
          tenantId: actor.tenantId,
          purpose: place.purpose,
          doctorProfileId: place.doctorProfileId,
          isCurrent: true,
        },
        data: { isCurrent: false },
      });
      if (result.count > 0) {
        await this.audit(tx, actor, place, 'remove');
      }
    });
  }

  /**
   * The bytes of one picture for a person allowed to see it. The hospital logo is shown to anyone
   * signed in to the hospital (it prints on every receipt); a signature only to its doctor and to
   * people who read visits or doctors. Anything else does not exist for the caller (404).
   */
  async open(
    actor: Actor,
    id: string,
  ): Promise<{ stream: Readable; contentType: string; byteSize: number; sha256: string }> {
    // an id is letters, digits, dash and underscore: anything else cannot exist (and never reaches the database)
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
    }
    const { row, active } = await this.tenantDb.withTenant(async (tx) => ({
      row: await tx.storedImage.findFirst({
        where: { id, tenantId: actor.tenantId },
        select: {
          contentType: true,
          byteSize: true,
          sha256: true,
          storageKey: true,
          purpose: true,
          doctorProfile: { select: { userId: true } },
        },
      }),
      // a switched-off person keeps a working token for a while: this route asks for no permission
      active: (
        await tx.user.findFirst({
          where: { id: actor.userId, tenantId: actor.tenantId },
          select: { isActive: true },
        })
      )?.isActive,
    }));
    if (!active || !row || !(await this.mayView(actor, row))) {
      throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
    }
    let stream: Readable;
    try {
      stream = await this.storage.get(actor.tenantId, row.storageKey);
    } catch {
      throw opdError(404, OpdErrorCode.SETTINGS_NOT_FOUND);
    }
    return { stream, contentType: row.contentType, byteSize: row.byteSize, sha256: row.sha256 };
  }

  private async mayView(
    actor: Actor,
    row: { purpose: string; doctorProfile: { userId: string } | null },
  ): Promise<boolean> {
    if (row.purpose === 'HOSPITAL_LOGO') {
      return true;
    }
    if (row.doctorProfile?.userId === actor.userId) {
      return true;
    }
    for (const code of ['opd.visits.read', 'opd.doctors.read']) {
      if ((await this.access.permittedBranches(code, 'OPD')).length > 0) {
        return true;
      }
    }
    return false;
  }

  /** The audit trail keeps what happened to which place, never the picture. */
  private async audit(
    tx: TenantTx,
    actor: Actor,
    place: { purpose: ImagePurpose; doctorProfileId: string | null },
    kind: 'replace' | 'remove',
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: 'IMAGE_CHANGE',
        entityType: place.doctorProfileId ? 'doctor_profiles' : 'hospitals',
        entityId: place.doctorProfileId ?? actor.tenantId,
        reason: kind === 'replace' ? 'A picture was uploaded' : 'A picture was removed',
        metadata: { purpose: place.purpose, kind },
      },
    });
  }
}
