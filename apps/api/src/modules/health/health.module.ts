import { Module } from '@nestjs/common';
import { PostgresChecker } from './checkers/postgres.checker';
import { QueueChecker } from './checkers/queue.checker';
import { RedisChecker } from './checkers/redis.checker';
import { StorageChecker } from './checkers/storage.checker';
import { WebsocketChecker } from './checkers/websocket.checker';
import { HealthController } from './health.controller';
import { HealthGateway } from './health.gateway';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    HealthGateway,
    PostgresChecker,
    RedisChecker,
    StorageChecker,
    WebsocketChecker,
    QueueChecker,
  ],
})
export class HealthModule {}
