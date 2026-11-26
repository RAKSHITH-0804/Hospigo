import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { DashboardService } from './dashboard.service';

type HttpReq = { auth?: AccessClaims };

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@TokenKinds('HOSPITAL')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      'Real numbers for the signed-in person dashboard (active branch); a block the person may not see is left out',
  })
  summary(@Req() req: HttpReq) {
    if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
      throw new UnauthorizedException('Hospital token required');
    }
    const c = req.auth as HospitalAccessClaims;
    return this.dashboard.summary({ tenantId: c.tenantId, userId: c.userId, branchId: c.branchId });
  }
}
