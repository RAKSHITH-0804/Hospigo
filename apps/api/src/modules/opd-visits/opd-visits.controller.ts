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
import {
  CreateVisitDto,
  PreviewVisitDto,
  UpdateReceptionSymptomsDto,
} from './dto/create-visit.dto';
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

  @Get('opd/payment-modes')
  @RequirePermission('opd.billing.collect', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Active payment modes (code, name, reference needed) plus the default mode and the most lines one receipt may carry',
  })
  async paymentModes(@Req() req: HttpReq) {
    return this.visits.listPaymentModes(actorOf(req));
  }

  @Post('opd/visits/preview')
  @HttpCode(200)
  @RequirePermission('opd.visits.create', { module: 'OPD' })
  @ApiOperation({
    summary:
      'What creating this visit would charge (lines and total in paise). Writes nothing, takes no number. Same checks and refusals as the real create.',
  })
  async preview(@Req() req: HttpReq, @Body() body: PreviewVisitDto) {
    return this.visits.previewVisit(body, actorOf(req));
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

  @Put('opd/visits/:id/reception-symptoms')
  @RequirePermission('opd.visits.create', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Reception sets or clears the symptoms of a visit (until the doctor starts the consultation)',
  })
  async setSymptoms(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Body() body: UpdateReceptionSymptomsDto,
  ) {
    return this.visits.setReceptionSymptoms(id, body.receptionSymptoms, actorOf(req));
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
