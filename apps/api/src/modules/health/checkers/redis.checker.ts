import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { CHECK_TIMEOUT_MS, delay, ServiceChecker, withTimeout } from '../service-checker';

@Injectable()
export class RedisChecker extends ServiceChecker {
  constructor(private readonly config: ConfigService) {
    super();
  }

  protected override async probe(): Promise<void> {
    const redis = new Redis(this.config.getOrThrow<string>('REDIS_URL'), {
      connectTimeout: CHECK_TIMEOUT_MS,
      commandTimeout: CHECK_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: () => null,
      reconnectOnError: () => false,
    });
    redis.on('error', () => undefined);

    const key = `hospigo:health:${randomUUID()}`;
    const operation = (async () => {
      await redis.connect();
      const pong = await redis.ping();
      if (pong !== 'PONG') {
        throw new Error(`Redis PING returned ${pong}`);
      }
      await redis.set(key, 'ok', 'EX', 30);
      const value = await redis.get(key);
      if (value !== 'ok') {
        throw new Error('Redis test key read returned an unexpected value');
      }
      await redis.del(key);
    })();

    try {
      await withTimeout(operation, CHECK_TIMEOUT_MS, 'redis');
    } finally {
      if (redis.status === 'ready') {
        await Promise.race([redis.del(key).catch(() => undefined), delay(500)]);
      }
      redis.disconnect();
    }
  }
}
