import { Controller, Get, Param, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import type { Actor } from '../opd-visits/opd-visits.service';
import { PatientHistoryService } from './patient-history.service';

const ID = /^[A-Za-z0-9_-]{1,64}$/;

type HttpReq = { auth?: AccessClaims };

function actorOf(req: HttpReq): Actor {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId, branchId: claims.branchId };
}

@ApiTags('patient-history')
@ApiBearerAuth()
@Controller()
@TokenKinds('HOSPITAL')
export class PatientHistoryController {
  constructor(private readonly history: PatientHistoryService) {}

  @Get('patients/:patientId/clinical-history')
  @RequirePermission('patients.history.view_all')
  @ApiOperation({
    summary:
      'One patient of the hospital with the whole clinical history, read-only, all branches and doctors (viewing is logged)',
  })
  async one(@Req() req: HttpReq, @Param('patientId') patientId: string) {
    if (!ID.test(patientId)) {
      return this.history.history('invalid-id', actorOf(req));
    }
    return this.history.history(patientId, actorOf(req));
  }
}
