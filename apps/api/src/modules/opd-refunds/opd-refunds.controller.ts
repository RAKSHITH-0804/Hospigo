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
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import {
  ApproveRefundDto,
  RejectRefundDto,
  RequestCancelDto,
  RequestRefundDto,
} from './dto/refunds.dto';
import { OPD_REFUNDS_CONFIG as C } from './opd-refunds.config';
import { RefundsService } from './refunds.service';

type HttpReq = { auth?: AccessClaims };
type HttpRes = { status: (code: number) => unknown };

const STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED'] as const;

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

@ApiTags('opd-refunds')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class OpdRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post('opd/bills/:billId/refund-requests')
  @HttpCode(201)
  @RequirePermission('opd.refunds.request', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Ask for money back on one bill (any amount up to paid minus refunded). An Admin decides. Same idempotencyKey = same request (200).',
  })
  async requestRefund(
    @Req() req: HttpReq,
    @Param('billId') billId: string,
    @Body() body: RequestRefundDto,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const result = await this.refunds.requestRefund(billId, body, actorOf(req));
    if (result.replayed) {
      res.status(200);
    }
    return result;
  }

  @Post('opd/visits/:id/cancel-requests')
  @HttpCode(201)
  @RequirePermission('opd.refunds.request', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Ask to cancel a WAITING visit (the consultation must not have started) and return its fee. An Admin decides; approval cancels the visit and takes its token out of the queue.',
  })
  async requestCancel(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Body() body: RequestCancelDto,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const result = await this.refunds.requestCancel(id, body, actorOf(req));
    if (result.replayed) {
      res.status(200);
    }
    return result;
  }

  @Get('opd/refund-requests')
  @RequirePermission('opd.billing.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Refund and cancellation requests of the active branch, newest first' })
  async list(
    @Req() req: HttpReq,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (status !== undefined && !(STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException('status must be REQUESTED, APPROVED or REJECTED');
    }
    return this.refunds.list(actorOf(req), {
      status,
      page: positiveInt(page, 1, Number.MAX_SAFE_INTEGER),
      pageSize: positiveInt(pageSize, C.listDefaultPageSize, C.listMaxPageSize),
    });
  }

  @Get('opd/refund-requests/:id')
  @RequirePermission('opd.billing.read', { module: 'OPD' })
  @ApiOperation({ summary: 'One refund or cancellation request' })
  async one(@Req() req: HttpReq, @Param('id') id: string) {
    return this.refunds.getOne(id, actorOf(req));
  }

  @Post('opd/refund-requests/:id/approve')
  @HttpCode(200)
  @RequirePermission('opd.refunds.approve', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Admin approves: refunds are written in the original payment modes, a voucher number is issued, a cancellation cancels the visit. Never the person who asked.',
  })
  async approve(@Req() req: HttpReq, @Param('id') id: string, @Body() body: ApproveRefundDto) {
    return this.refunds.approve(id, body, actorOf(req));
  }

  @Post('opd/refund-requests/:id/reject')
  @HttpCode(200)
  @RequirePermission('opd.refunds.approve', { module: 'OPD' })
  @ApiOperation({ summary: 'Admin rejects the request with a note. Never the person who asked.' })
  async reject(@Req() req: HttpReq, @Param('id') id: string, @Body() body: RejectRefundDto) {
    return this.refunds.reject(id, body, actorOf(req));
  }
}
