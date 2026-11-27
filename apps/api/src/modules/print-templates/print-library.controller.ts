import {
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { PrintLibraryService } from './print-library.service';
import { parseScope } from './print-templates.service';

type HttpReq = { auth?: AccessClaims };

function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

/** Step 2.1f: the Indigo template library as a hospital sees it (only what is assigned to it). */
@ApiTags('print-library')
@Controller('print-library')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class PrintLibraryController {
  constructor(private readonly library: PrintLibraryService) {}

  @Get()
  @RequirePermission('print.templates.choose', { module: 'OPD' })
  @ApiOperation({
    summary: 'The templates and logos Indigo assigned to this hospital, and which is active',
  })
  list(@Req() req: HttpReq) {
    return this.library.list(actorOf(req));
  }

  @Put('templates/:id/choose')
  @HttpCode(200)
  @RequirePermission('print.templates.choose', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Use an assigned template for its document: scope=branch for the signed-in branch, scope=hospital (default) for the whole hospital',
  })
  chooseTemplate(@Req() req: HttpReq, @Param('id') id: string, @Query('scope') scope?: string) {
    return this.library.chooseTemplate(actorOf(req), id, parseScope(scope));
  }

  @Put('logos/:id/choose')
  @HttpCode(200)
  @RequirePermission('print.templates.choose', { module: 'OPD' })
  @ApiOperation({ summary: 'Use an assigned logo as the hospital logo (whole hospital only)' })
  chooseLogo(@Req() req: HttpReq, @Param('id') id: string) {
    return this.library.chooseLogo(actorOf(req), id);
  }

  @Get('templates/:id')
  @RequirePermission('print.templates.choose', { module: 'OPD' })
  @ApiOperation({ summary: 'One assigned design, to look at before choosing it (Phase 2.3)' })
  viewTemplate(@Param('id') id: string) {
    return this.library.viewTemplate(id);
  }

  @Get('logos/:id/image')
  @RequirePermission('print.templates.choose', { module: 'OPD' })
  @ApiOperation({ summary: 'The picture of an assigned logo (for the chooser)' })
  async logoImage(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: { set: (headers: Record<string, string>) => void },
  ) {
    const found = await this.library.logoImage(actorOf(req), id);
    res.set({
      'Content-Type': found.contentType,
      'Content-Length': String(found.data.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(found.data);
  }
}
