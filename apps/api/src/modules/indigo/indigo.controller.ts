import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HqAccessClaims } from '../auth/token.types';
import { HqMonitoringService } from './hq-monitoring.service';
import { IndigoConsoleService } from './indigo-console.service';

type HttpReq = { auth?: AccessClaims };
const hqId = (req: HttpReq): string => (req.auth as HqAccessClaims).userId;

/**
 * Step 2.1e: the Indigo console API. Every route needs an Indigo (HQ) token; the service decides what
 * an Owner and an Employee may do (Owner: everything; Employee: only sees the assigned hospitals).
 * Hospital users have a different token kind and get 401/403 here.
 */
@ApiTags('indigo-console')
@ApiBearerAuth()
@Controller('indigo')
@TokenKinds('HQ')
export class IndigoController {
  constructor(
    private readonly console: IndigoConsoleService,
    private readonly monitoring: HqMonitoringService,
  ) {}

  @Get('hospitals')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The hospitals this Indigo person may see, with branches and modules' })
  overview(@Req() req: HttpReq) {
    return this.console.overview(hqId(req));
  }

  @Post('hospitals')
  @HttpCode(201)
  @AuthenticatedOnly()
  @ApiOperation({
    summary:
      'Onboard a hospital (HQ Admin only): branches, access codes, modules, roles, first Super Admin',
  })
  onboard(@Req() req: HttpReq, @Body() body: unknown) {
    return this.console.onboard(hqId(req), body);
  }

  @Put('hospitals/:id/modules')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Switch modules on or off for a hospital and its branches (Owner only)',
  })
  setModules(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.console.setModules(hqId(req), id, body);
  }

  @Get('employees')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'HQ Staff and their hospitals (HQ Admin only)' })
  employees(@Req() req: HttpReq) {
    return this.console.employees(hqId(req));
  }

  @Post('employees')
  @HttpCode(201)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Create HQ Staff with a one-time temporary password (HQ Admin only)',
  })
  createEmployee(@Req() req: HttpReq, @Body() body: unknown) {
    return this.console.createEmployee(hqId(req), body);
  }

  @Put('employees/:id/hospitals')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Set the hospitals an Employee may enter (Owner only)' })
  setHospitals(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.console.setEmployeeHospitals(hqId(req), id, body);
  }

  @Post('employees/:id/deactivate')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Switch an Employee off (Owner only); their sessions end at the next refresh',
  })
  deactivate(@Req() req: HttpReq, @Param('id') id: string) {
    return this.console.setEmployeeActive(hqId(req), id, false);
  }

  @Post('employees/:id/reactivate')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Switch an Employee on again (Owner only)' })
  reactivate(@Req() req: HttpReq, @Param('id') id: string) {
    return this.console.setEmployeeActive(hqId(req), id, true);
  }

  @Put('employees/:id/permissions')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Set the tick-box permissions of one HQ Staff person (HQ Admin only)' })
  setPermissions(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.console.setEmployeePermissions(hqId(req), id, body);
  }

  @Get('monitoring')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Counts per hospital: visits, active users, last activity (no names, no money)',
  })
  counts(@Req() req: HttpReq) {
    return this.monitoring.counts(hqId(req));
  }

  @Get('health')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'One system status: API, database, storage, migrations' })
  health(@Req() req: HttpReq) {
    return this.monitoring.systemHealth(hqId(req));
  }

  @Get('activity')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The HQ activity log (HQ Admin only)' })
  activity(@Req() req: HttpReq, @Query('page') page?: string) {
    return this.monitoring.activity(hqId(req), Number(page ?? 1));
  }

  @Get('hospitals/:id/super-admins')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The Super Admin accounts of a hospital' })
  superAdmins(@Req() req: HttpReq, @Param('id') id: string) {
    return this.monitoring.superAdmins(hqId(req), id);
  }

  @Post('hospitals/:id/super-admins')
  @HttpCode(201)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Create the first Super Admin of a hospital that has none' })
  createSuperAdmin(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.monitoring.createSuperAdmin(hqId(req), id, body);
  }

  @Post('hospitals/:id/super-admins/:userId/reset')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'One-time password for a Super Admin (shown once; old sessions end)' })
  resetSuperAdmin(@Req() req: HttpReq, @Param('id') id: string, @Param('userId') userId: string) {
    return this.monitoring.resetSuperAdmin(hqId(req), id, userId);
  }
}
