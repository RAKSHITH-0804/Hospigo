import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthEmailService } from './auth-email.service';
import { AuthService } from './auth.service';
import { BranchSwitchService } from './branch-switch.service';
import { AuthRateLimitedError } from './auth-redis.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  ForgotPasswordAcceptedDto,
  ForgotPasswordDto,
  HqForgotPasswordDto,
} from './dto/forgot-password.dto';
import { HospitalLoginDto } from './dto/hospital-login.dto';
import { HqLoginDto } from './dto/hq-login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthMeResponseDto } from './dto/auth-me.dto';
import { ActivateDto, ResetPasswordDto } from './dto/reset-activate.dto';
import { SwitchableBranchDto, SwitchBranchDto } from './dto/switch-branch.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { Public } from './public.decorator';
import { TokenKinds } from './token-kinds.decorator';
import { IndigoEnterDto } from './dto/indigo-enter.dto';
import { INDIGO_HOSPITAL_UNAVAILABLE, IndigoAccessService } from './indigo-access.service';
import type { AccessClaims, HospitalAccessClaims } from './token.types';

type HttpReq = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: AccessClaims;
};

type HttpRes = {
  setHeader: (name: string, value: string) => void;
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authEmail: AuthEmailService,
    private readonly branchSwitch: BranchSwitchService,
    private readonly indigo: IndigoAccessService,
  ) {}

  @Public()
  @Post('hospital/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hospital staff login (access code + email + password)' })
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Generic authentication failure' })
  async hospitalLogin(
    @Body() body: HospitalLoginDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<TokenResponseDto> {
    return this.wrapRateLimit(res, () => this.auth.hospitalLogin(body, clientMeta(req)));
  }

  @Public()
  @Post('hq/login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Indigo HQ login (email + password)' })
  @ApiOkResponse({ type: TokenResponseDto })
  async hqLogin(
    @Body() body: HqLoginDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<TokenResponseDto> {
    return this.wrapRateLimit(res, () => this.auth.hqLogin(body, clientMeta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token and issue a new access token' })
  @ApiOkResponse({ type: TokenResponseDto })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<TokenResponseDto> {
    return this.wrapRateLimit(res, () => this.auth.refresh(body.refreshToken, clientMeta(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke a refresh session (body refreshToken; idempotent; no Bearer required)',
  })
  async logout(@Body() body: LogoutDto): Promise<{ ok: true }> {
    return this.auth.logout(body.refreshToken);
  }

  @Post('change-password')
  @HttpCode(200)
  @AuthenticatedOnly()
  @TokenKinds('HOSPITAL', 'HQ', 'CHANGE_PASSWORD_HOSPITAL', 'CHANGE_PASSWORD_HQ')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password; revokes other sessions; returns fresh tokens' })
  @ApiOkResponse({ type: TokenResponseDto })
  async changePassword(
    @Body() body: ChangePasswordDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<TokenResponseDto> {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    return this.wrapRateLimit(res, () =>
      this.auth.changePassword(req.auth!, body, clientMeta(req)),
    );
  }

  @Get('me')
  @AuthenticatedOnly()
  @TokenKinds('HOSPITAL', 'HQ')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Current user profile (no secrets)',
    description: 'Hospital: includes permissions[] for the active branch. HQ: permissions is [].',
  })
  @ApiOkResponse({ type: AuthMeResponseDto })
  async me(@Req() req: HttpReq): Promise<AuthMeResponseDto> {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    return this.auth.me(req.auth);
  }

  @Get('indigo/hospitals')
  @AuthenticatedOnly()
  @TokenKinds('HQ', 'HOSPITAL')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The hospitals an Indigo person may enter now (Step 2.1b)' })
  async indigoHospitals(@Req() req: HttpReq) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    const person = await this.indigo.personOf(req.auth);
    return { items: person ? await this.indigo.hospitals(person) : [] };
  }

  @Post('indigo/enter')
  @HttpCode(200)
  @AuthenticatedOnly()
  @TokenKinds('HQ', 'HOSPITAL')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'An Indigo person enters one hospital and gets an ordinary hospital token (Step 2.1b). One answer for every refusal.',
  })
  @ApiOkResponse({ type: TokenResponseDto })
  async indigoEnter(
    @Body() body: IndigoEnterDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<TokenResponseDto> {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    // an Indigo token, or the token of an Indigo person already inside a hospital (switching hospital)
    const hqUserId = await this.indigo.personOf(req.auth);
    if (!hqUserId) {
      throw new ForbiddenException(INDIGO_HOSPITAL_UNAVAILABLE);
    }
    return this.wrapRateLimit(res, () =>
      this.indigo.enter(hqUserId, body.hospitalId, clientMeta(req)),
    );
  }

  @Get('switchable-branches')
  @AuthenticatedOnly()
  @TokenKinds('HOSPITAL')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Branches the caller may switch to (hospital-wide users only; others get 403)',
  })
  @ApiOkResponse({ type: [SwitchableBranchDto] })
  async switchableBranches(@Req() req: HttpReq): Promise<SwitchableBranchDto[]> {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    return this.branchSwitch.listSwitchable(req.auth as HospitalAccessClaims);
  }

  @Post('switch-branch')
  @HttpCode(200)
  @AuthenticatedOnly()
  @TokenKinds('HOSPITAL')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Switch the active branch (hospital-wide users only). Rotates the refresh token and returns a new access token for the target branch.',
  })
  @ApiOkResponse({ type: TokenResponseDto })
  async switchBranchRoute(
    @Body() body: SwitchBranchDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<TokenResponseDto> {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    return this.wrapRateLimit(res, () =>
      this.branchSwitch.switchBranch(req.auth as HospitalAccessClaims, body, clientMeta(req)),
    );
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({
    summary:
      'Request hospital password-reset email (always 202; does not reveal account existence)',
  })
  @ApiAcceptedResponse({ type: ForgotPasswordAcceptedDto })
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<ForgotPasswordAcceptedDto> {
    return this.wrapRateLimit(res, () => this.authEmail.forgotPassword(body, clientMeta(req)));
  }

  @Public()
  @Post('hq/forgot-password')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Request HQ password-reset email (always 202; does not reveal account existence)',
  })
  @ApiAcceptedResponse({ type: ForgotPasswordAcceptedDto })
  async hqForgotPassword(
    @Body() body: HqForgotPasswordDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<ForgotPasswordAcceptedDto> {
    return this.wrapRateLimit(res, () => this.authEmail.hqForgotPassword(body, clientMeta(req)));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Complete password reset with email link token' })
  @ApiNoContentResponse()
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<void> {
    await this.wrapRateLimit(res, () => this.authEmail.resetPassword(body, clientMeta(req)));
  }

  @Public()
  @Post('activate')
  @HttpCode(204)
  @ApiOperation({ summary: 'Activate hospital account with email link token' })
  @ApiNoContentResponse()
  async activate(
    @Body() body: ActivateDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<void> {
    await this.wrapRateLimit(res, () => this.authEmail.activate(body, clientMeta(req)));
  }

  private async wrapRateLimit<T>(res: HttpRes, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AuthRateLimitedError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        throw new HttpException(
          { statusCode: 429, message: 'Too many requests', error: 'Too Many Requests' },
          429,
        );
      }
      throw error;
    }
  }
}

function clientMeta(req: HttpReq): { ip: string; userAgent: string | undefined } {
  const ip = typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : '0.0.0.0';
  const rawUa = req.headers['user-agent'];
  const userAgent = typeof rawUa === 'string' ? rawUa : undefined;
  return { ip, userAgent };
}
