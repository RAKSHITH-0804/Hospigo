import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma';
import type { ApiEnv } from '../config/env';

/**
 * Prisma client bound to DATABASE_URL_PATIENT (hospigo_patient).
 * Provide only from the patient auth module — never from hospital feature modules.
 */
@Injectable()
export class PatientPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<ApiEnv, true>) {
    const connectionString = config.getOrThrow('DATABASE_URL_PATIENT', { infer: true });
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
