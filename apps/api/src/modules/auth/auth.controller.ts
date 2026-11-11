import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthRateLimitedError } from './auth-redis.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { HospitalLoginDto } from './dto/hospital-login.dto';
import { HqLoginDto } from './dto/hq-login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { Public } from './public.decorator';
import { TokenKinds } from './token-kinds.decorator';
import type { AccessClaims } from './token.types';

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
  constructor(private readonly auth: AuthService) {}

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
  @TokenKinds('HOSPITAL', 'HQ')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user profile (no secrets)' })
  async me(@Req() req: HttpReq) {
    if (!req.auth) {
      throw new UnauthorizedException('Missing auth context');
    }
    return this.auth.me(req.auth);
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
