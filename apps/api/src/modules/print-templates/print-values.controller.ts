import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
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
import { OPD_PRICES_CONFIG } from '../opd-prices/opd-prices.config';
import type { Actor } from '../opd-visits/opd-visits.service';
import { parseScope } from './print-templates.service';
import { PrintValuesService } from './print-values.service';

type HttpReq = { auth?: AccessClaims };

/** Branch, tenant and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

function idOf(value: string): string {
  if (!OPD_PRICES_CONFIG.idPattern.test(value)) {
    throw new BadRequestException('id is not valid');
  }
  return value;
}

/**
 * Extra print values (Step 8c). Every signed-in staff member can read the values that apply to their
 * branch (the print screens need them); the OPD settings permission manages them, for the signed-in
 * branch or, with the permission in every branch, for the whole hospital.
 */
@ApiTags('print-values')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class PrintValuesController {
  constructor(private readonly values: PrintValuesService) {}

  @Get('print-values')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'The active extra print values that apply to the signed-in branch (text only)',
  })
  async effective(@Req() req: HttpReq) {
    return this.values.effective(actorOf(req));
  }

  @Get('print-values/manage')
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'All values of the hospital and of the signed-in branch, switched off ones too',
  })
  async manage(@Req() req: HttpReq) {
    return this.values.manage(actorOf(req));
  }

  @Post('print-values')
  @HttpCode(201)
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Add a value (key, label, text). scope=branch for the signed-in branch, scope=hospital (default) needs the permission in every branch.',
  })
  async create(@Req() req: HttpReq, @Body() body: unknown, @Query('scope') scope?: string) {
    return this.values.create(actorOf(req), parseScope(scope), body);
  }

  @Put('print-values/:id')
  @HttpCode(200)
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Change the label or text of a value, or switch it off or on' })
  async update(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.values.update(actorOf(req), idOf(id), body);
  }
}
