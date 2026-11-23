import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { ChangeChargeItemPriceDto, ChangeDoctorFeeDto } from './dto/prices.dto';
import {
  OPD_PRICES_CONFIG as C,
  PRICE_KINDS,
  VISIT_TYPES,
  type PriceKind,
  type PriceVisitType,
} from './opd-prices.config';
import { PricesService } from './prices.service';

type HttpReq = { auth?: AccessClaims };

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

function idOf(value: string | undefined, name: string): string {
  if (!value || !C.idPattern.test(value)) {
    throw new BadRequestException(`${name} is missing or not valid`);
  }
  return value;
}

/**
 * Prices of the registration fee, tests and doctor fees (Step 8b, part B).
 * Hospital-wide; Admin and SuperAdmin only (permission opd.prices.write for reading too).
 */
@ApiTags('opd-prices')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class OpdPricesController {
  constructor(private readonly prices: PricesService) {}

  @Get('opd/prices')
  @RequirePermission('opd.prices.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Current prices (registration fee, tests, doctor fees for new and follow-up visits), with the next scheduled price; searchable and paged',
  })
  async list(
    @Req() req: HttpReq,
    @Query('q') q?: string,
    @Query('kind') kind?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (kind !== undefined && kind !== '' && !(PRICE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException('kind must be REGISTRATION, INVESTIGATION or DOCTOR_FEE');
    }
    return this.prices.list(actorOf(req), {
      q,
      kind: kind ? (kind as PriceKind) : undefined,
      page: positiveInt(page, 1, Number.MAX_SAFE_INTEGER),
      pageSize: positiveInt(pageSize, C.listDefaultPageSize, C.listMaxPageSize),
    });
  }

  @Get('opd/prices/history')
  @RequirePermission('opd.prices.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'All versions of one price, newest first. Give itemId (registration fee or a test), or doctorProfileId and visitType (a doctor fee)',
  })
  async history(
    @Req() req: HttpReq,
    @Query('itemId') itemId?: string,
    @Query('doctorProfileId') doctorProfileId?: string,
    @Query('visitType') visitType?: string,
  ) {
    if (itemId !== undefined) {
      if (doctorProfileId !== undefined || visitType !== undefined) {
        throw new BadRequestException('Give itemId, or doctorProfileId with visitType, not both');
      }
      return this.prices.history(actorOf(req), { kind: 'ITEM', itemId: idOf(itemId, 'itemId') });
    }
    if (!visitType || !(VISIT_TYPES as readonly string[]).includes(visitType)) {
      throw new BadRequestException('visitType must be NEW or FOLLOW_UP');
    }
    return this.prices.history(actorOf(req), {
      kind: 'DOCTOR_FEE',
      doctorProfileId: idOf(doctorProfileId, 'doctorProfileId'),
      visitType: visitType as PriceVisitType,
    });
  }

  @Post('opd/prices/items/:id')
  @HttpCode(200)
  @RequirePermission('opd.prices.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Add a new price version for the registration fee or a test. Only new bills use it. The same amount again changes nothing (changed false).',
  })
  async changeItem(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Body() body: ChangeChargeItemPriceDto,
  ) {
    return this.prices.changeChargeItemPrice(idOf(id, 'id'), body, actorOf(req));
  }

  @Post('opd/prices/doctor-fees')
  @HttpCode(200)
  @RequirePermission('opd.prices.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Add a new doctor fee version (new or follow-up visits). Only new bills use it. The same amount again changes nothing (changed false).',
  })
  async changeDoctorFee(@Req() req: HttpReq, @Body() body: ChangeDoctorFeeDto) {
    return this.prices.changeDoctorFee(body, actorOf(req));
  }
}
