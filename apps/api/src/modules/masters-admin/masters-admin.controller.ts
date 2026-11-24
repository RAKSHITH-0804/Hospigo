import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { MASTERS_CONFIG as C } from './masters.config';
import { NumberSeriesAdminService } from './number-series-admin.service';
import { PaymentModesService } from './payment-modes.service';
import { VitalsFieldsService } from './vitals-fields.service';

type HttpReq = { auth?: AccessClaims };

/** Hospital and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

function idOf(value: string): string {
  if (!C.idPattern.test(value)) {
    throw new BadRequestException('id is not valid');
  }
  return value;
}

/**
 * The masters screens of Settings, OPD (Step 8c): payment modes and vitals fields. Everything needs
 * the permission to write the OPD masters (a reader of the masters is not enough to see these lists).
 */
@ApiTags('masters-admin')
@Controller('settings')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class MastersAdminController {
  constructor(
    private readonly modes: PaymentModesService,
    private readonly vitals: VitalsFieldsService,
    private readonly series: NumberSeriesAdminService,
  ) {}

  // ----------------------------------------------------------------------- payment modes

  @Get('payment-modes')
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'All payment modes of the hospital, switched off ones included' })
  async paymentModes(@Req() req: HttpReq) {
    return this.modes.list(actorOf(req));
  }

  @Post('payment-modes')
  @HttpCode(201)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Add a payment mode (code, name, reference needed)' })
  async addPaymentMode(@Req() req: HttpReq, @Body() body: unknown) {
    return this.modes.create(actorOf(req), body);
  }

  @Put('payment-modes/:id')
  @HttpCode(200)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Rename a payment mode, change its reference flag, switch it off or on (never deleted)',
  })
  async changePaymentMode(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.modes.update(actorOf(req), idOf(id), body);
  }

  // ------------------------------------------------------------------------ vitals fields

  @Get('vitals-fields')
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'All vitals fields of the hospital, switched off ones included' })
  async vitalsFields(@Req() req: HttpReq) {
    return this.vitals.list(actorOf(req));
  }

  @Post('vitals-fields')
  @HttpCode(201)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Add a vitals field (code, name, unit, number or text, usual range)' })
  async addVitalsField(@Req() req: HttpReq, @Body() body: unknown) {
    return this.vitals.create(actorOf(req), body);
  }

  @Post('vitals-fields/reorder')
  @HttpCode(200)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Put all the vitals fields in the given order' })
  async reorderVitals(@Req() req: HttpReq, @Body() body: unknown) {
    return this.vitals.reorder(actorOf(req), body);
  }

  @Put('vitals-fields/:id')
  @HttpCode(200)
  @RequirePermission('opd.masters.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'Change name, unit, usual range or switch a vitals field off or on (never deleted)',
  })
  async changeVitalsField(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.vitals.update(actorOf(req), idOf(id), body);
  }

  // ----------------------------------------------------------------------- number series

  @Get('number-series')
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'The bill, receipt and refund number series: format, reset rule, whether they are locked and the next number (hospital-wide Admin only)',
  })
  async numberSeries(@Req() req: HttpReq) {
    return this.series.list(actorOf(req));
  }

  @Put('number-series/:series/start-number')
  @HttpCode(200)
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Raise the counter of the current period so the next number is the one given (never lowers it; needs a reason)',
  })
  async setStartNumber(
    @Req() req: HttpReq,
    @Param('series') series: string,
    @Body() body: unknown,
  ) {
    return this.series.setStartNumber(actorOf(req), series, body);
  }

  @Put('number-series/:series')
  @HttpCode(200)
  @RequirePermission('opd.settings.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Change the prefix, separator, financial year style and width of a series (only new numbers change); the reset rule and the financial year start only before the first number',
  })
  async changeNumberSeries(
    @Req() req: HttpReq,
    @Param('series') series: string,
    @Body() body: unknown,
  ) {
    return this.series.update(actorOf(req), series, body);
  }
}
