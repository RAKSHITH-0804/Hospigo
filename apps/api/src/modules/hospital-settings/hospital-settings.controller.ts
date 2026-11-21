import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { OpdRulesService } from '../opd-masters/opd-rules.service';
import { PatientFieldSettingsService } from '../patients/patient-field-settings.service';
import { UhidService } from '../patients/uhid.service';
import { parseUhidFormat } from '../patients/uhid-format.rules';

type HttpReq = { auth?: AccessClaims };

/** Hospital, branch and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

@ApiTags('hospital-settings')
@Controller('settings')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class HospitalSettingsController {
  constructor(
    private readonly rules: OpdRulesService,
    private readonly fields: PatientFieldSettingsService,
    private readonly uhid: UhidService,
  ) {}

  // ------------------------------------------------------------------ OPD rules

  @Get('opd-rules')
  @RequirePermission('hospital.settings.read')
  @ApiOperation({ summary: 'Free follow-up days and free repeat-visit hours of this hospital' })
  async opdRules(@Req() req: HttpReq) {
    return this.rules.get(actorOf(req).tenantId);
  }

  @Put('opd-rules')
  @HttpCode(200)
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Change the free follow-up days and/or free repeat-visit hours' })
  async saveOpdRules(@Req() req: HttpReq, @Body() body: unknown) {
    return this.rules.update(actorOf(req), body);
  }

  // ------------------------------------------------------------ registration fields

  @Get('patient-fields')
  @RequirePermission('hospital.settings.read')
  @ApiOperation({ summary: 'Built-in and custom registration fields with their switches' })
  async patientFields(@Req() req: HttpReq) {
    return this.fields.list(actorOf(req));
  }

  @Put('patient-fields/builtin/:key')
  @HttpCode(200)
  @RequirePermission('hospital.settings.write')
  @ApiOperation({ summary: 'Turn a built-in field on or off, required or optional' })
  async saveBuiltin(@Req() req: HttpReq, @Param('key') key: string, @Body() body: unknown) {
    return this.fields.updateBuiltin(actorOf(req), key, body);
  }

  @Post('patient-fields/custom')
  @RequirePermission('hospital.settings.write')
  @ApiOperation({ summary: 'Add a field of the hospital to the registration form' })
  async createCustom(@Req() req: HttpReq, @Body() body: unknown) {
    return this.fields.createCustom(actorOf(req), body);
  }

  @Patch('patient-fields/custom/:id')
  @RequirePermission('hospital.settings.write')
  @ApiOperation({ summary: 'Rename, move, switch off/on or make required a custom field' })
  async updateCustom(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.fields.updateCustom(actorOf(req), id, body);
  }

  @Put('patient-fields/custom/:id/options')
  @HttpCode(200)
  @RequirePermission('hospital.settings.write')
  @ApiOperation({ summary: 'Replace the choices of a dropdown field (never deletes a choice)' })
  async saveOptions(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.fields.replaceOptions(actorOf(req), id, body);
  }

  // ----------------------------------------------------------------- UHID format

  @Get('uhid-format')
  @RequirePermission('hospital.settings.read')
  @ApiOperation({ summary: 'The patient number format in use, a sample, and the next number' })
  async uhidFormat(@Req() req: HttpReq) {
    const { tenantId, branchId } = actorOf(req);
    return this.uhid.getFormat({ tenantId, branchId });
  }

  @Post('uhid-format')
  @HttpCode(200)
  @RequirePermission('hospital.settings.write')
  @ApiOperation({
    summary:
      'Start a new patient number format from now on (old numbers never change; the running number never goes back)',
  })
  async saveUhidFormat(@Req() req: HttpReq, @Body() body: unknown) {
    const actor = actorOf(req);
    const format = parseUhidFormat(body);
    await this.uhid.changeFormat({ tenantId: actor.tenantId, userId: actor.userId, format });
    return this.uhid.getFormat({ tenantId: actor.tenantId, branchId: actor.branchId });
  }
}
