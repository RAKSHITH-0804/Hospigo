import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  CHECK_TIMEOUT_MS,
  delay,
  type HealthMetrics,
  ServiceChecker,
  withTimeout,
} from '../service-checker';

@Injectable()
export class QueueChecker extends ServiceChecker {
  constructor(private readonly config: ConfigService) {
    super();
  }

  protected override async probe(): Promise<HealthMetrics> {
    const connection = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      connectTimeout: CHECK_TIMEOUT_MS,
      commandTimeout: CHECK_TIMEOUT_MS,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      lazyConnect: false,
      retryStrategy: () => null,
      reconnectOnError: () => false,
    });
    connection.on('error', () => undefined);

    const queue = new Queue('health', { connection });
    queue.on('error', () => undefined);

    const operation = queue.getJobCounts('waiting', 'failed').then((counts) => ({
      waiting: counts.waiting ?? 0,
      failed: counts.failed ?? 0,
    }));

    try {
      return await withTimeout(operation, CHECK_TIMEOUT_MS, 'queue');
    } finally {
      await Promise.race([queue.close().catch(() => undefined), delay(500)]);
      connection.disconnect();
    }
  }
}
