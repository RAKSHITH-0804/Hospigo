import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedOnly, RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { parseDocType, parseScope, PrintTemplatesService } from './print-templates.service';

type HttpReq = { auth?: AccessClaims };

/** Branch, tenant and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

@ApiTags('print-templates')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class PrintTemplatesController {
  constructor(private readonly templates: PrintTemplatesService) {}

  @Get('print-templates')
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      'The template that applies to the signed-in branch for every document (registration slip, receipt, prescription): the branch own, else the hospital one, else the built-in default; and what the caller may change',
  })
  async list(@Req() req: HttpReq) {
    return this.templates.list(actorOf(req));
  }

  @Get('print-templates/presets')
  @RequirePermission('hospital.settings.read')
  @ApiOperation({ summary: 'The built-in presets and what each gives every document' })
  presets() {
    return this.templates.presets();
  }

  @Get('print-templates/:docType')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The template of one document' })
  async one(@Req() req: HttpReq, @Param('docType') docType: string) {
    return this.templates.getOne(actorOf(req), parseDocType(docType));
  }

  @Put('print-templates/:docType')
  @HttpCode(200)
  @RequirePermission('print.templates.manage', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Save the template of one document (replaces it). scope=branch saves it for the signed-in branch only; scope=hospital (the default) for the whole hospital and needs the permission in every branch. Paper, margins, mode and layout are checked field by field.',
  })
  async save(
    @Req() req: HttpReq,
    @Param('docType') docType: string,
    @Body() body: Record<string, unknown>,
    @Query('scope') scope?: string,
  ) {
    return this.templates.saveWithRetry(
      actorOf(req),
      parseDocType(docType),
      body,
      parseScope(scope),
    );
  }

  @Delete('print-templates/:docType')
  @HttpCode(200)
  @RequirePermission('print.templates.manage', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Remove the saved template of one document in the chosen scope (branch or hospital): the lookup then falls back to the next level',
  })
  async reset(
    @Req() req: HttpReq,
    @Param('docType') docType: string,
    @Query('scope') scope?: string,
  ) {
    return this.templates.reset(actorOf(req), parseDocType(docType), parseScope(scope));
  }
}
