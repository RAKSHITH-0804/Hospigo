import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayInit } from '@nestjs/websockets';
import type { Server } from 'socket.io';

@WebSocketGateway({ transports: ['websocket', 'polling'] })
export class HealthGateway implements OnGatewayInit {
  @WebSocketServer()
  server?: Server;

  afterInit(server: Server): void {
    this.server = server;
  }
}
