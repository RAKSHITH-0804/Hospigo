import {
  CallHandler,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessService } from '../access/access.service';
import { AuthenticatedOnly, RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { TenantDb } from '../../database/tenant-db';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import { IMAGE_CACHE_SECONDS, IMAGE_LIMITS } from './images.config';
import { ImagesService, imageLimitsView } from './images.service';

type HttpReq = { auth?: AccessClaims };
type Upload = { buffer: Buffer } | undefined;

/** Hospital and user come ONLY from the verified token, never from the request. */
export function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

/**
 * The upload reader: one file in the field "file", kept in memory. A file bigger than the limit is
 * stopped while it is being read (so a huge upload is never held in full) and answered like any
 * other refusal of a picture: `400 SETTINGS_INVALID { field: 'file', reason: 'TOO_BIG' }`.
 */
const ReadOnePicture = FileInterceptor('file', {
  limits: { fileSize: IMAGE_LIMITS.maxBytes + 1, files: 1, fields: 0, parts: 2 },
});

@Injectable()
export class PictureUploadInterceptor extends ReadOnePicture implements NestInterceptor {
  override async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw opdError(400, OpdErrorCode.SETTINGS_INVALID, { field: 'file', reason: 'TOO_BIG' });
      }
      throw error;
    }
  }
}

export const pictureUpload = () => PictureUploadInterceptor;

@ApiTags('images')
@Controller('images')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get(':id')
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      'The bytes of one picture (logo for everyone signed in; a signature only for those who may see it)',
  })
  async get(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: { set: (headers: Record<string, string>) => void },
  ) {
    const found = await this.images.open(actorOf(req), id);
    res.set({
      'Content-Type': found.contentType,
      'Content-Length': String(found.byteSize),
      'Content-Disposition': 'inline',
      'Cache-Control': `private, max-age=${IMAGE_CACHE_SECONDS}, immutable`,
      ETag: `"${found.sha256}"`,
      // the bytes are only ever shown as a picture, never run or sniffed as something else
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(found.stream);
  }
}

@ApiTags('images')
@Controller('settings/branding')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class BrandingController {
  constructor(
    private readonly images: ImagesService,
    private readonly access: AccessService,
    private readonly tenantDb: TenantDb,
  ) {}

  private async requireHospitalWide(): Promise<void> {
    if ((await this.access.hospitalWideBranches('print.templates.manage')).length === 0) {
      throw new ForbiddenException();
    }
  }

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The hospital logo (current picture) and the upload limits' })
  async get(@Req() req: HttpReq) {
    const actor = actorOf(req);
    const logo = await this.tenantDb.withTenant((tx) =>
      this.images.current(tx, actor.tenantId, 'HOSPITAL_LOGO', null),
    );
    const canWrite = (await this.access.hospitalWideBranches('print.templates.manage')).length > 0;
    return { logo, canWrite, limits: imageLimitsView() };
  }

  @Put('logo')
  @HttpCode(200)
  @RequirePermission('print.templates.manage')
  @UseInterceptors(pictureUpload())
  @ApiOperation({ summary: 'Upload the hospital logo (hospital-wide Admin only)' })
  async putLogo(@Req() req: HttpReq, @UploadedFile() file: Upload) {
    await this.requireHospitalWide();
    return this.images.replace(
      actorOf(req),
      { purpose: 'HOSPITAL_LOGO', doctorProfileId: null },
      file?.buffer,
    );
  }

  @Post('logo/remove')
  @HttpCode(200)
  @RequirePermission('print.templates.manage')
  @ApiOperation({ summary: 'Stop using a logo (the old picture stays on record)' })
  async removeLogo(@Req() req: HttpReq) {
    await this.requireHospitalWide();
    await this.images.removeCurrent(actorOf(req), {
      purpose: 'HOSPITAL_LOGO',
      doctorProfileId: null,
    });
    return { logo: null };
  }
}
