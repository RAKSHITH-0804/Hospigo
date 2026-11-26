import { Controller, Get, Module, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantDb } from '../../database/tenant-db';
import { AuthenticatedOnly } from '../access/permission.decorators';
import { TokenKinds } from '../auth/token-kinds.decorator';
import type { AccessClaims, HospitalAccessClaims } from '../auth/token.types';
import { isHospitalTokenType } from '../auth/token.types';

type HttpReq = { auth?: AccessClaims };

/**
 * Step 2.1f: the words the signed-in hospital prefers for a few terms (set by Indigo only). Any signed-in
 * person may read them; the screens fall back to the words of the copy file for every key not listed.
 */
@ApiTags('terminology')
@ApiBearerAuth()
@Controller('terminology')
@TokenKinds('HOSPITAL')
export class TerminologyController {
  constructor(private readonly tenantDb: TenantDb) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'The words this hospital prefers, as { key: text }' })
  async list(@Req() req: HttpReq) {
    if (!req.auth || !isHospitalTokenType(req.auth.tokenType)) {
      throw new UnauthorizedException('Hospital token required');
    }
    const { tenantId } = req.auth as HospitalAccessClaims;
    const rows = await this.tenantDb.withTenant((tx) =>
      tx.terminologyOverride.findMany({
        where: { tenantId },
        select: { key: true, text: true },
      }),
    );
    return { items: Object.fromEntries(rows.map((r) => [r.key, r.text])) };
  }
}

@Module({ controllers: [TerminologyController] })
export class TerminologyModule {}
