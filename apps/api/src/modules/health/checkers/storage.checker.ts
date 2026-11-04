import { Inject, Injectable } from '@nestjs/common';
import { CHECK_TIMEOUT_MS, ServiceChecker, withTimeout } from '../service-checker';
import { STORAGE_SERVICE, type StorageService } from '../../storage/storage.service';

@Injectable()
export class StorageChecker extends ServiceChecker {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService) {
    super();
  }

  protected override async probe(): Promise<void> {
    await withTimeout(this.storage.health(), CHECK_TIMEOUT_MS, 'storage');
  }
}
