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
import { OPD_PRICES_CONFIG } from '../opd-prices/opd-prices.config';
import { DoctorAvailabilityAdminService } from './availability.service';

type HttpReq = { auth?: AccessClaims };

/** Hospital and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

function idOf(value: string | undefined, name: string): string {
  if (!value || !OPD_PRICES_CONFIG.idPattern.test(value)) {
    throw new BadRequestException(`${name} is not valid`);
  }
  return value;
}

/**
 * Doctor availability (Step 8b, part D): the on/off switch, the weekly timetable per branch and
 * leave periods. Reading needs opd.doctors.read, changing needs opd.doctors.write.
 */
@ApiTags('doctor-availability')
@Controller('opd/doctors/:id/availability')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class DoctorAvailabilityController {
  constructor(private readonly availability: DoctorAvailabilityAdminService) {}

  @Get()
  @RequirePermission('opd.doctors.read', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Switch, weekly timetable (branches the caller may see) and leave periods of one doctor in the caller scope',
  })
  async view(@Req() req: HttpReq, @Param('id') id: string) {
    return this.availability.view(actorOf(req), idOf(id, 'id'));
  }

  @Put('switch')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({ summary: 'Switch a doctor on or off (off blocks assignment: Not Available Now)' })
  async setSwitch(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.availability.setSwitch(actorOf(req), idOf(id, 'id'), body);
  }

  @Put('timings/:branchId')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({
    summary:
      'Replace the whole weekly timetable of a doctor in one branch (an empty list clears it). Timings only warn.',
  })
  async setTimings(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    return this.availability.setTimings(
      actorOf(req),
      idOf(id, 'id'),
      idOf(branchId, 'branchId'),
      body,
    );
  }

  @Post('leave')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'Add a leave period (first and last day). Leave blocks assignment on those days.',
  })
  async addLeave(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.availability.addLeave(actorOf(req), idOf(id, 'id'), body);
  }

  @Post('leave/:leaveId/remove')
  @HttpCode(200)
  @RequirePermission('opd.doctors.write', { module: 'OPD' })
  @ApiOperation({
    summary: 'Remove a leave period (the doctor can be assigned again on those days)',
  })
  async removeLeave(
    @Req() req: HttpReq,
    @Param('id') id: string,
    @Param('leaveId') leaveId: string,
  ) {
    return this.availability.removeLeave(actorOf(req), idOf(id, 'id'), idOf(leaveId, 'leaveId'));
  }
}
