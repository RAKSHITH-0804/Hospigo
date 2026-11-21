import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { DoctorProfilesService } from './doctor-profiles.service';

type HttpReq = { auth?: AccessClaims };

/** Hospital and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

@ApiTags('doctor-profiles')
@Controller('doctor-profiles')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class DoctorProfilesController {
  constructor(private readonly profiles: DoctorProfilesService) {}

  @Get('me')
  @RequirePermission('opd.doctors.own', { module: 'OPD' })
  @ApiOperation({ summary: 'The profile of the signed-in doctor (found from the token user)' })
  async me(@Req() req: HttpReq) {
    return this.profiles.me(actorOf(req));
  }

  @Put('me')
  @HttpCode(200)
  @RequirePermission('opd.doctors.own', { module: 'OPD' })
  @ApiOperation({
    summary:
      'A doctor changes their own printed name, qualifications, speciality and registration number (not the department)',
  })
  async saveMe(@Req() req: HttpReq, @Body() body: unknown) {
    return this.profiles.updateMe(actorOf(req), body);
  }

  @Get()
  @RequirePermission('opd.doctors.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Doctors the caller may see with their profile details: every doctor for a hospital-wide Admin, doctors of their own branches for a Branch Admin',
  })
  async list(@Req() req: HttpReq) {
    return this.profiles.list(actorOf(req));
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'An Admin corrects a doctor profile, including the department (a doctor outside the Admin scope is 404)',
  })
  async save(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.profiles.updateByAdmin(actorOf(req), id, body);
  }
}
