import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AccessService } from '../access/access.service';
import { RequirePermission } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { RolesService } from './roles.service';
import { StaffCodeService } from './staff-code.service';
import { StaffService } from './staff.service';

type HttpReq = { auth?: AccessClaims };

/** Hospital and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

function whole(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,6}$/.test(value)) {
    return undefined;
  }
  return Number(value);
}

@ApiTags('staff')
@Controller('staff')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly codes: StaffCodeService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('user.read')
  @ApiOperation({ summary: 'The staff the caller may see (search, status, pages)' })
  async list(
    @Req() req: HttpReq,
    @Query() query: { q?: string; status?: string; page?: string; pageSize?: string },
  ) {
    return this.staff.list(actorOf(req), {
      q: typeof query.q === 'string' ? query.q : undefined,
      status: typeof query.status === 'string' ? query.status : undefined,
      page: whole(query.page),
      pageSize: whole(query.pageSize),
    });
  }

  @Get('options')
  @RequirePermission('user.read')
  @ApiOperation({ summary: 'Roles, branches and the code format the "Add staff" form may offer' })
  async options(@Req() req: HttpReq) {
    return this.staff.options(actorOf(req));
  }

  @Get('code-format')
  @RequirePermission('user.read')
  @ApiOperation({ summary: 'How new staff codes are made (prefix, digits) and the next one' })
  async codeFormat(@Req() req: HttpReq) {
    return this.codes.get(actorOf(req).tenantId);
  }

  @Put('code-format')
  @HttpCode(200)
  @RequirePermission('hospital.settings.write')
  @ApiOperation({ summary: 'Change how new staff codes are made (hospital-wide Admin only)' })
  async saveCodeFormat(@Req() req: HttpReq, @Body() body: unknown) {
    if ((await this.access.hospitalWideBranches('hospital.settings.write')).length === 0) {
      throw new ForbiddenException();
    }
    return this.codes.set(actorOf(req), body);
  }

  @Post()
  @RequirePermission('user.write')
  @ApiOperation({ summary: 'Add a staff member and send the activation email' })
  async create(@Req() req: HttpReq, @Body() body: unknown) {
    return this.staff.create(actorOf(req), body);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermission('user.write')
  @ApiOperation({ summary: 'Change name, email, phone, branches and roles of a staff member' })
  async update(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.staff.update(actorOf(req), id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('user.write')
  @ApiOperation({ summary: 'Switch a person off: they are signed out at once; nothing is deleted' })
  async deactivate(@Req() req: HttpReq, @Param('id') id: string) {
    return this.staff.setActive(actorOf(req), id, false);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('user.write')
  @ApiOperation({ summary: 'Switch a person on again' })
  async reactivate(@Req() req: HttpReq, @Param('id') id: string) {
    return this.staff.setActive(actorOf(req), id, true);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermission('user.write')
  @ApiOperation({
    summary:
      'Send a staff member a password reset link (Super Admin: anyone but self; Admin: own branches, never a Super Admin)',
  })
  async resetPassword(@Req() req: HttpReq, @Param('id') id: string) {
    return this.staff.sendPasswordReset(actorOf(req), id);
  }

  @Post(':id/resend-invite')
  @HttpCode(200)
  @RequirePermission('user.write')
  @ApiOperation({ summary: 'Send the activation email again (only before a password is set)' })
  async resend(@Req() req: HttpReq, @Param('id') id: string) {
    return this.staff.resendInvite(actorOf(req), id);
  }
}

@ApiTags('roles')
@Controller('roles')
@TokenKinds('HOSPITAL')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('role.read')
  @ApiOperation({
    summary: 'The roles of the hospital with their permissions and how many hold each',
  })
  async list(@Req() req: HttpReq) {
    return this.roles.list(actorOf(req));
  }

  @Get('catalog')
  @RequirePermission('role.read')
  @ApiOperation({ summary: 'Every permission with its plain description' })
  async catalog() {
    return this.roles.catalog();
  }

  @Get('templates')
  @RequirePermission('role.read')
  @ApiOperation({ summary: 'Ready-made roles to start from' })
  async templates() {
    return this.roles.templates();
  }

  @Post()
  @RequirePermission('role.write')
  @ApiOperation({
    summary: 'Make a role of the hospital by choosing permissions (hospital-wide Admin only)',
  })
  async create(@Req() req: HttpReq, @Body() body: unknown) {
    return this.roles.create(actorOf(req), body);
  }

  @Put(':id')
  @HttpCode(200)
  @RequirePermission('role.write')
  @ApiOperation({
    summary: 'Change the name, description or permissions of a role of the hospital',
  })
  async update(@Req() req: HttpReq, @Param('id') id: string, @Body() body: unknown) {
    return this.roles.update(actorOf(req), id, body);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('role.write')
  @ApiOperation({ summary: 'Switch a role nobody holds off' })
  async deactivate(@Req() req: HttpReq, @Param('id') id: string) {
    return this.roles.setActive(actorOf(req), id, false);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('role.write')
  @ApiOperation({ summary: 'Switch a role on again' })
  async reactivate(@Req() req: HttpReq, @Param('id') id: string) {
    return this.roles.setActive(actorOf(req), id, true);
  }
}
