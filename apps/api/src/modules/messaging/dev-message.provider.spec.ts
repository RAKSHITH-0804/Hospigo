/**
 * @jest-environment node
 */
import { ConfigService } from '@nestjs/config';
import { DevMessageProvider } from './dev-message.provider';

describe('DevMessageProvider', () => {
  it('throws onModuleInit when NODE_ENV=production', () => {
    const config = {
      getOrThrow: () => 'production',
    } as unknown as ConfigService;
    const provider = new DevMessageProvider(config);
    expect(() => provider.onModuleInit()).toThrow(/must not run when NODE_ENV=production/);
  });

  it('allows non-production', () => {
    const config = {
      getOrThrow: () => 'test',
    } as unknown as ConfigService;
    const provider = new DevMessageProvider(config);
    expect(() => provider.onModuleInit()).not.toThrow();
  });
});
