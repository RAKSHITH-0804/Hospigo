import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';
import { AccountService } from './account.service';

type HttpReq = { auth?: AccessClaims };

/** Hospital and user come ONLY from the verified token, never from the request. */
function actorOf(req: HttpReq) {
  if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Hospital token required');
  }
  const claims = req.auth as HospitalAccessClaims;
  return { tenantId: claims.tenantId, userId: claims.userId };
}

@ApiTags('account')
@Controller('account')
@TokenKinds('HOSPITAL')
@AuthenticatedOnly()
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid hospital token' })
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get('me')
  @ApiOperation({ summary: 'My profile: name, email, phone, branches, roles' })
  async me(@Req() req: HttpReq) {
    return this.account.me(actorOf(req));
  }

  @Put('me')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change my own name and phone' })
  async saveMe(@Req() req: HttpReq, @Body() body: unknown) {
    return this.account.updateMe(actorOf(req), body);
  }

  @Post('email/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a code to a NEW email address to prove it is mine' })
  async requestEmail(@Req() req: HttpReq, @Body() body: unknown, @Ip() ip: string) {
    return this.account.requestEmailChange(actorOf(req), body, ip);
  }

  @Post('email/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the code and switch to the new email address' })
  async confirmEmail(@Req() req: HttpReq, @Body() body: unknown) {
    return this.account.confirmEmailChange(actorOf(req), body);
  }

  @Post('password/request')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a code to my own email address (the address must be typed)' })
  async requestPassword(@Req() req: HttpReq, @Body() body: unknown, @Ip() ip: string) {
    return this.account.requestPasswordChange(actorOf(req), body, ip);
  }

  @Post('password/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the code, set the new password and sign out everywhere' })
  async confirmPassword(@Req() req: HttpReq, @Body() body: unknown) {
    return this.account.confirmPasswordChange(actorOf(req), body);
  }
}
