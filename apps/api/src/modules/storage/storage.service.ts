import type { Readable } from 'stream';

export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

/**
 * Object-storage contract. Callers depend on this token only so an S3-compatible
 * driver can replace the local-folder implementation without caller changes.
 * Store binary bytes here — never base64 blobs in the database.
 */
export abstract class StorageService {
  abstract put(tenantPrefix: string, key: string, data: Buffer | Readable): Promise<void>;

  abstract get(tenantPrefix: string, key: string): Promise<Readable>;

  abstract delete(tenantPrefix: string, key: string): Promise<void>;

  abstract exists(tenantPrefix: string, key: string): Promise<boolean>;

  abstract health(): Promise<void>;
}
