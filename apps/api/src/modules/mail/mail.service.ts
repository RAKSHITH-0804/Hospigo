import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import type { ApiEnv } from '../../config/env';
import type { AuthConfig } from '../auth/auth.config';
import { MAIL_QUEUE_NAME, type MailJobData } from './mail.types';

@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly queue: Queue<MailJobData>;
  private readonly connection: Redis;
  private readonly auth: AuthConfig;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.auth = config.getOrThrow('auth', { infer: true });
    this.connection = new Redis(config.getOrThrow('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
    this.queue = new Queue<MailJobData>(MAIL_QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: this.auth.mailJobAttempts,
        backoff: { type: 'exponential', delay: this.auth.mailJobBackoffMs },
        removeOnComplete: this.auth.mailRemoveOnCompleteCount,
        removeOnFail: this.auth.mailRemoveOnFailCount,
      },
    });
  }

  async enqueue(data: MailJobData): Promise<void> {
    await this.queue.add(data.kind, data);
    this.logger.log(
      `Mail job enqueued kind=${data.kind} tenant=${data.tenantId ?? 'hq'} userId=${data.userId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
    await this.connection.quit().catch(() => undefined);
  }
}
