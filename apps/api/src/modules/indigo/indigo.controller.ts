import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HqAccessClaims } from '../auth/token.types';
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
  constructor(private readonly console: IndigoConsoleService) {}

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
      'Onboard a hospital (Owner only): branches, access codes, modules, roles, first SuperAdmin',
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
  @ApiOperation({ summary: 'Indigo Employees and their hospitals (Owner only)' })
  employees(@Req() req: HttpReq) {
    return this.console.employees(hqId(req));
  }

  @Post('employees')
  @HttpCode(201)
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Create an Indigo Employee with a one-time temporary password (Owner only)',
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
}
