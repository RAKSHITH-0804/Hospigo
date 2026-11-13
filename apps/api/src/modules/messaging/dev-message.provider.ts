import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import type { MessageChannel, MessageProvider } from './message.provider';

/**
 * Dev-only OTP delivery: logs the full message (including OTP) via Nest Logger.
 * Refuses to load when NODE_ENV=production.
 */
@Injectable()
export class DevMessageProvider implements MessageProvider, OnModuleInit {
  private readonly logger = new Logger(DevMessageProvider.name);

  constructor(private readonly config: ConfigService<ApiEnv, true>) {}

  onModuleInit(): void {
    const nodeEnv = this.config.getOrThrow('NODE_ENV', { infer: true });
    if (nodeEnv === 'production') {
      throw new Error('DevMessageProvider must not run when NODE_ENV=production');
    }
  }

  async send(channel: MessageChannel, phoneE164: string, text: string): Promise<void> {
    this.logger.log(`[dev-otp] channel=${channel} phone=${phoneE164} text=${text}`);
  }
}
