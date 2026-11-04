import { Injectable } from '@nestjs/common';
import { PostgresChecker } from './checkers/postgres.checker';
import { QueueChecker } from './checkers/queue.checker';
import { RedisChecker } from './checkers/redis.checker';
import { StorageChecker } from './checkers/storage.checker';
import { WebsocketChecker } from './checkers/websocket.checker';
import { toErrorMessage, type HealthDetails, type ServiceHealth } from './service-checker';

@Injectable()
export class HealthService {
  constructor(
    private readonly postgres: PostgresChecker,
    private readonly redis: RedisChecker,
    private readonly storage: StorageChecker,
    private readonly websocket: WebsocketChecker,
    private readonly queue: QueueChecker,
  ) {}

  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  async getDetails(): Promise<HealthDetails> {
    const checkedAt = new Date().toISOString();
    try {
      const [postgres, redis, storage, websocket, queue] = await Promise.all([
        this.postgres.check(),
        this.redis.check(),
        this.storage.check(),
        this.websocket.check(),
        this.queue.check(),
      ]);
      const services = { postgres, redis, storage, websocket, queue };
      const status = Object.values(services).every((service) => service.status === 'up')
        ? 'ok'
        : 'degraded';

      return {
        status,
        checkedAt: new Date().toISOString(),
        services,
      };
    } catch (error) {
      const down = this.failedService(checkedAt, error);
      return {
        status: 'degraded',
        checkedAt,
        services: {
          postgres: down,
          redis: down,
          storage: down,
          websocket: down,
          queue: down,
        },
      };
    }
  }

  private failedService(checkedAt: string, error: unknown): ServiceHealth {
    return {
      status: 'down',
      responseTimeMs: 0,
      checkedAt,
      error: toErrorMessage(error),
    };
  }
}
