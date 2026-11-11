import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';
import type { ApiEnv } from '../config/env';

/**
 * Prisma client bound to DATABASE_URL_HQ (hospigo_hq).
 * Import and provide only from the HQ auth path — never from hospital feature modules.
 */
@Injectable()
export class HqPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<ApiEnv, true>) {
    const connectionString = config.getOrThrow('DATABASE_URL_HQ', { infer: true });
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
