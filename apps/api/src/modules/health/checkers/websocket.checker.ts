import { Injectable } from '@nestjs/common';
import type { HealthMetrics } from '../service-checker';
import { ServiceChecker } from '../service-checker';
import { HealthGateway } from '../health.gateway';

@Injectable()
export class WebsocketChecker extends ServiceChecker {
  constructor(private readonly gateway: HealthGateway) {
    super();
  }

  protected override probe(): Promise<HealthMetrics> {
    const server = this.gateway.server;
    if (!server) {
      return Promise.reject(new Error('Socket.IO gateway is not initialized'));
    }

    const clients = server.engine?.clientsCount ?? server.sockets?.sockets?.size ?? 0;
    return Promise.resolve({ clients });
  }
}
