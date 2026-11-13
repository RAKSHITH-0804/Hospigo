import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import { DevMessageProvider } from './dev-message.provider';
import { MESSAGE_PROVIDER } from './message.provider';

@Module({
  providers: [
    DevMessageProvider,
    {
      provide: MESSAGE_PROVIDER,
      inject: [ConfigService, DevMessageProvider],
      useFactory: (config: ConfigService<ApiEnv, true>, dev: DevMessageProvider) => {
        const driver = config.getOrThrow('auth', { infer: true }).otpDriver;
        if (driver === 'dev') {
          return dev;
        }
        throw new Error(`Unsupported OTP_DRIVER=${driver} (only "dev" is implemented)`);
      },
    },
  ],
  exports: [MESSAGE_PROVIDER],
})
export class MessagingModule {}
