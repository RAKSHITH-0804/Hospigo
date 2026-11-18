import {
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
import { CreateVisitDto } from './dto/create-visit.dto';
import { OPD_VISITS_CONFIG as C } from './opd-visits.config';
import { OpdVisitsService, type Actor } from './opd-visits.service';

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

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1) {
    return fallback;
  }
  return Math.min(n, max);
}

@ApiTags('opd-visits')
@Controller()
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class OpdVisitsController {
  constructor(private readonly visits: OpdVisitsService) {}

  @Get('opd/doctors')
  @RequirePermission('opd.visits.create', { module: 'OPD' })
  @ApiOperation({ summary: 'Doctors of the active branch with availability and current fees' })
  async doctors(@Req() req: HttpReq) {
    return this.visits.listDoctors(actorOf(req));
  }

  @Post('opd/visits')
  @HttpCode(201)
  @RequirePermission('opd.visits.create', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Create a visit, bill the consultation and take payment in ONE transaction (needs opd.billing.collect too). Same idempotencyKey = same result (200).',
  })
  async create(
    @Req() req: HttpReq,
    @Body() body: CreateVisitDto,
    @Res({ passthrough: true }) res: HttpRes,
  ) {
    const result = await this.visits.createVisit(body, actorOf(req));
    if (result.replayed) {
      res.status(200);
    }
    return { replayed: result.replayed, ...result.visit };
  }

  @Get('opd/visits/:id')
  @RequirePermission('opd.visits.read', { module: 'OPD' })
  @ApiOperation({ summary: 'One visit of the active branch (money only with opd.billing.read)' })
  async one(@Req() req: HttpReq, @Param('id') id: string) {
    return this.visits.getVisit(id, actorOf(req));
  }

  @Get('patients/:patientId/visits')
  @RequirePermission('opd.visits.read', { module: 'OPD' })
  @ApiOperation({ summary: 'Visits of one patient in the active branch, newest first' })
  async forPatient(
    @Req() req: HttpReq,
    @Param('patientId') patientId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.visits.listForPatient(
      patientId,
      actorOf(req),
      positiveInt(page, 1, Number.MAX_SAFE_INTEGER),
      positiveInt(pageSize, C.listDefaultPageSize, C.listMaxPageSize),
    );
  }
}
