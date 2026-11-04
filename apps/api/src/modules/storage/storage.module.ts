import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import { LocalFolderStorageDriver } from './local-folder.storage';
import { STORAGE_SERVICE } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: LocalFolderStorageDriver,
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        new LocalFolderStorageDriver(config.getOrThrow('STORAGE_ROOT_PATH', { infer: true })),
      inject: [ConfigService],
    },
    {
      provide: STORAGE_SERVICE,
      useExisting: LocalFolderStorageDriver,
    },
  ],
  exports: [STORAGE_SERVICE, LocalFolderStorageDriver],
})
export class StorageModule {}
