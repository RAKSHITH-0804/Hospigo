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
import { OPD_PRICES_CONFIG } from '../opd-prices/opd-prices.config';
import { LEAVE_REQUEST_LIMITS, LeaveRequestsService } from './leave-requests.service';

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
  if (!OPD_PRICES_CONFIG.idPattern.test(value)) {
    throw new BadRequestException('id is not valid');
  }
  return value;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, max);
}

/**
 * Doctor leave requests (Step 8c). A doctor asks for leave and sees the state of the requests
 * (opd.doctors.own); an Admin approves or rejects (opd.doctors.write, same scope as the Doctors page).
 */
@ApiTags('leave-requests')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class LeaveRequestsController {
  constructor(private readonly requests: LeaveRequestsService) {}

  @Post('doctor-profiles/me/leave-requests')
  @HttpCode(201)
  @RequirePermission('opd.doctors.own', { module: 'OPD' })
  @ApiOperation({ summary: 'A doctor asks for leave (first and last day). It waits for an Admin.' })
  async request(@Req() req: HttpReq, @Body() body: unknown) {
    return this.requests.request(actorOf(req), body);
  }

  @Get('doctor-profiles/me/leave-requests')
  @RequirePermission('opd.doctors.own', { module: 'OPD' })
  @ApiOperation({
    summary: 'The leave requests of the signed-in doctor, newest first, with their state',
  })
  async mine(@Req() req: HttpReq) {
    return this.requests.listMine(actorOf(req));
  }

  @Post('doctor-profiles/me/leave-requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission('opd.doctors.own', { module: 'OPD' })
  @ApiOperation({ summary: 'A doctor cancels a request that is still waiting' })
  async cancel(@Req() req: HttpReq, @Param('id') id: string) {
    return this.requests.cancel(actorOf(req), idOf(id));
  }

  @Get('opd/leave-requests')
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Leave requests of the doctors the caller may manage (default: the waiting ones), with the count of waiting ones',
  })
  async list(
    @Req() req: HttpReq,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.requests.listForAdmin(actorOf(req), {
      status: status || undefined,
      page: positiveInt(page, 1, Number.MAX_SAFE_INTEGER),
      pageSize: positiveInt(
        pageSize,
        LEAVE_REQUEST_LIMITS.defaultPageSize,
        LEAVE_REQUEST_LIMITS.maxPageSize,
      ),
    });
  }

  @Post('opd/leave-requests/:id/approve')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Approve a request: the leave is created and the doctor cannot be picked on those days',
  })
  async approve(@Req() req: HttpReq, @Param('id') id: string) {
    return this.requests.approve(actorOf(req), idOf(id));
  }

  @Post('opd/leave-requests/:id/reject')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Reject a request: nothing else changes' })
  async reject(@Req() req: HttpReq, @Param('id') id: string) {
    return this.requests.reject(actorOf(req), idOf(id));
  }
}
