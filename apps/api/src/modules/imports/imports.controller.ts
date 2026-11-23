import {
  BadRequestException,
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  NestInterceptor,
  Param,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { OpdErrorCode, opdError } from '../opd-visits/opd-visit.errors';
import { IMPORT_LIMITS, XLSX_CONTENT_TYPE } from './import.config';
import { ImportsService } from './imports.service';

type HttpReq = { auth?: AccessClaims };
type HttpRes = { setHeader: (name: string, value: string) => unknown };

/** Branch, tenant and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, max);
}

function idOf(value: string): string {
  if (!IMPORT_LIMITS.idPattern.test(value)) {
    throw new BadRequestException('id is not valid');
  }
  return value;
}

/**
 * The upload reader: one file in the field "file", kept in memory. A file bigger than the limit is
 * stopped while it is being read and answered like any other refusal of a file.
 */
const ReadOneFile = FileInterceptor('file', {
  limits: { fileSize: IMPORT_LIMITS.maxBytes + 1, files: 1, fields: 0, parts: 2 },
});

@Injectable()
export class ImportUploadInterceptor extends ReadOneFile implements NestInterceptor {
  override async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) {
        throw opdError(400, OpdErrorCode.IMPORT_FILE_INVALID, { reason: 'TOO_BIG' });
      }
      throw error;
    }
  }
}

/**
 * Excel upload of the masters (Step 8b, part C). Admin and SuperAdmin only
 * (opd.masters.write; the price lists also need opd.prices.write, checked inside).
 */
@ApiTags('imports')
@Controller('imports')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('templates/:type')
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'A sample Excel file for one kind of list (TESTS, DOCTOR_FEES, MEDICINES)',
  })
  async template(@Param('type') type: string, @Res({ passthrough: true }) res: HttpRes) {
    const bytes = await this.imports.template(type);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${type.toLowerCase()}-template.xlsx"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(bytes);
  }

  @Post(':type/upload')
  @HttpCode(202)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @UseInterceptors(ImportUploadInterceptor)
  @ApiOperation({
    summary:
      'Upload an Excel file. It is read in the background (see the batch status); nothing is saved to the masters until it is approved and posted.',
  })
  async upload(
    @Req() req: HttpReq,
    @Param('type') type: string,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string } | undefined,
  ) {
    return this.imports.upload(actorOf(req), type, file);
  }

  @Get()
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'The upload batches of the hospital, newest first' })
  async list(
    @Req() req: HttpReq,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.imports.list(actorOf(req), {
      page: positiveInt(page, 1, Number.MAX_SAFE_INTEGER),
      pageSize: positiveInt(
        pageSize,
        IMPORT_LIMITS.listDefaultPageSize,
        IMPORT_LIMITS.listMaxPageSize,
      ),
    });
  }

  @Get(':id')
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'One batch and its status (ask again while a run is going)' })
  async one(@Req() req: HttpReq, @Param('id') id: string) {
    return this.imports.getBatch(actorOf(req), idOf(id));
  }

  @Get(':id/rows')
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'The rows of a batch (status EXCEPTION lists the problems)' })
  async rows(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (status !== undefined && !['EXCEPTION', 'VALID', 'POSTED'].includes(status)) {
      throw new BadRequestException('status must be EXCEPTION, VALID or POSTED');
    }
    return this.imports.rows(actorOf(req), idOf(id), {
      status: status as 'EXCEPTION' | 'VALID' | 'POSTED' | undefined,
      page: positiveInt(page, 1, Number.MAX_SAFE_INTEGER),
      pageSize: positiveInt(
        pageSize,
        IMPORT_LIMITS.rowsDefaultPageSize,
        IMPORT_LIMITS.listMaxPageSize,
      ),
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Approve a previewed batch (rows with problems stay out)' })
  async approve(@Req() req: HttpReq, @Param('id') id: string) {
    return this.imports.approve(actorOf(req), idOf(id));
  }

  @Post(':id/post')
  @HttpCode(202)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Save an approved batch to the masters (in the background, all or nothing). After this a batch is final: a correction is a new upload.',
  })
  async post(@Req() req: HttpReq, @Param('id') id: string) {
    return this.imports.post(actorOf(req), idOf(id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Cancel a batch that has not been posted (nothing was saved)' })
  async cancel(@Req() req: HttpReq, @Param('id') id: string) {
    return this.imports.cancel(actorOf(req), idOf(id));
  }
}
