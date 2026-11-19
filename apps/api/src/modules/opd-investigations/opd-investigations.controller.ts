import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
import { BillInvestigationsDto, SaveOrdersDto } from './dto/investigations.dto';
import { InvestigationsService } from './investigations.service';
import { OPD_INVESTIGATIONS_CONFIG as C } from './opd-investigations.config';

type HttpReq = { auth?: AccessClaims };
type HttpRes = { status: (code: number) => unknown };

/** Branch, tenant and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

@ApiTags('opd-investigations')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class OpdInvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get('opd/investigations/tests')
  @RequirePermission('opd.masters.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Search the active tests list (name or code), no prices' })
  async tests(@Req() req: HttpReq, @Query('q') q?: string, @Query('limit') limit?: string) {
    const n = Number(limit);
    return this.investigations.searchTests(
      actorOf(req),
      typeof q === 'string' ? q : '',
      Number.isInteger(n) && n > 0 ? n : C.searchDefaultLimit,
    );
  }

  @Get('opd/investigations/pending')
  @RequirePermission('opd.investigations.bill', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Visits of the active branch with tests ordered by the doctor and not yet billed, with current prices',
  })
  async pending(@Req() req: HttpReq) {
    return this.investigations.listPending(actorOf(req));
  }

  @Put('opd/visits/:id/investigations')
  @HttpCode(200)
  @RequirePermission('opd.investigations.order', { module: 'OPD' })
  @ApiOperation({
    summary:
      'The assigned doctor sets the tests for the visit (replaces the tests still only ordered). Only while in consultation.',
  })
  async saveOrders(@Req() req: HttpReq, @Param('id') id: string, @Body() body: SaveOrdersDto) {
    return this.investigations.saveOrders(id, body, actorOf(req));
  }

  @Get('opd/visits/:id/investigations')
  @RequirePermission('opd.visits.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Tests of one visit (doctor: own visit; reception: any visit of the branch, with the investigations bills when allowed)',
  })
  async forVisit(@Req() req: HttpReq, @Param('id') id: string) {
    return this.investigations.getForVisit(id, actorOf(req));
  }

  @Post('opd/visits/:id/investigation-bills')
  @HttpCode(201)
  @RequirePermission('opd.investigations.bill', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Bill the tests the patient will take and take payment in ONE transaction (needs opd.billing.collect too). Same idempotencyKey = same result (200).',
  })
  async bill(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Body() body: BillInvestigationsDto,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const result = await this.investigations.billInvestigations(id, body, actorOf(req));
    if (result.replayed) {
      res.status(200);
    }
    return result;
  }
}
