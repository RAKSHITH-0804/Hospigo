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
import { AuthRateLimitedError } from '../auth/auth-redis.service';
import { LogoutDto } from '../auth/dto/logout.dto';
import { RefreshDto } from '../auth/dto/refresh.dto';
import { Public } from '../auth/public.decorator';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, PatientAccessClaims } from '../auth/token.types';
import { isPatientTokenType } from '../auth/token.types';
import { PatientTokenResponseDto } from './dto/patient-token-response.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PatientAuthService } from './patient-auth.service';

type HttpReq = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: AccessClaims;
};

type HttpRes = {
  setHeader: (name: string, value: string) => void;
};

@ApiTags('patient')
@Controller('patient')
export class PatientAuthController {
  constructor(private readonly patientAuth: PatientAuthService) {}

  @Public()
  @Post('auth/request-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a patient login OTP (identical response for any phone)' })
  async requestOtp(
    @Body() body: RequestOtpDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<{ ok: true; resendAfterSec: number }> {
    return this.wrapRateLimit(res, () =>
      this.patientAuth.requestOtp(body.phone, 'LOGIN', clientIp(req)),
    );
  }

  @Public()
  @Post('auth/verify-otp')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify OTP and issue patient access + refresh tokens' })
  @ApiOkResponse({ type: PatientTokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Generic authentication failure' })
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<PatientTokenResponseDto> {
    return this.wrapRateLimit(res, () =>
      this.patientAuth.verifyOtp(body.phone, body.code, 'LOGIN', clientIp(req), {
        userAgent: headerString(req.headers['user-agent']),
      }),
    );
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate patient refresh token' })
  @ApiOkResponse({ type: PatientTokenResponseDto })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: HttpReq,
    @Res({ passthrough: true }) res: HttpRes,
  ): Promise<PatientTokenResponseDto> {
    return this.wrapRateLimit(res, () =>
      this.patientAuth.refresh(body.refreshToken, {
        ip: clientIp(req),
        userAgent: headerString(req.headers['user-agent']),
      }),
    );
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Revoke a patient refresh session family (body refreshToken; idempotent; no Bearer)',
  })
  async logout(@Body() body: LogoutDto): Promise<{ ok: true }> {
    return this.patientAuth.logout(body.refreshToken);
  }

  @Get('me')
  @TokenKinds('PATIENT')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current patient account (masked phone; no hospital links yet)' })
  async me(@Req() req: HttpReq) {
    return this.patientAuth.me(requirePatient(req));
  }

  private async wrapRateLimit<T>(res: HttpRes, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AuthRateLimitedError) {
        res.setHeader('Retry-After', String(error.retryAfterSec));
        throw new HttpException(
          {
            statusCode: 429,
            message: 'Too many requests',
            error: 'Too Many Requests',
          },
          429,
        );
      }
      throw error;
    }
  }
}

function requirePatient(req: HttpReq): PatientAccessClaims {
  if (!req.auth || !isPatientTokenType(req.auth.tokenType)) {
    throw new UnauthorizedException('Missing auth context');
  }
  return req.auth as PatientAccessClaims;
}

function clientIp(req: HttpReq): string {
  return typeof req.ip === 'string' && req.ip.length > 0 ? req.ip : '0.0.0.0';
}

function headerString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}
