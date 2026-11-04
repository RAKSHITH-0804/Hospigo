import { createReadStream, createWriteStream } from 'fs';
import { access, mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { StorageService } from './storage.service';

export class LocalFolderStorageDriver extends StorageService {
  private readonly rootPath: string;

  constructor(rootPath: string) {
    super();
    this.rootPath = path.resolve(rootPath);
  }

  override async put(tenantPrefix: string, key: string, data: Buffer | Readable): Promise<void> {
    const target = this.resolveObjectPath(tenantPrefix, key);
    await mkdir(path.dirname(target), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await writeFile(target, data);
      return;
    }

    await pipeline(data, createWriteStream(target));
  }

  override async get(tenantPrefix: string, key: string): Promise<Readable> {
    const target = this.resolveObjectPath(tenantPrefix, key);
    await access(target);
    return createReadStream(target);
  }

  override async delete(tenantPrefix: string, key: string): Promise<void> {
    const target = this.resolveObjectPath(tenantPrefix, key);
    await unlink(target);
  }

  override async exists(tenantPrefix: string, key: string): Promise<boolean> {
    try {
      await access(this.resolveObjectPath(tenantPrefix, key));
      return true;
    } catch {
      return false;
    }
  }

  override async health(): Promise<void> {
    const healthDir = path.join(this.rootPath, '.health');
    await mkdir(healthDir, { recursive: true });
    const probe = path.join(healthDir, `probe-${randomUUID()}`);
    await writeFile(probe, 'ok');
    await unlink(probe);
  }

  resolveObjectPath(tenantPrefix: string, key: string): string {
    const tenant = this.sanitizeSegment(tenantPrefix, 'tenantPrefix');
    const relativeKey = this.sanitizeKey(key);
    const resolved = path.resolve(this.rootPath, tenant, relativeKey);
    this.assertInsideRoot(resolved);
    return resolved;
  }

  private sanitizeKey(key: string): string {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error('Storage key is required');
    }

    const trimmed = key.trim().replace(/\\/g, '/');
    if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) {
      throw new Error('Storage key must be a relative path');
    }
    if (trimmed.split('/').some((part) => part === '..')) {
      throw new Error('Storage key must not contain ".."');
    }
    if (trimmed.includes('\0')) {
      throw new Error('Storage key is invalid');
    }

    return trimmed
      .split('/')
      .filter((part) => part !== '' && part !== '.')
      .join(path.sep);
  }

  private sanitizeSegment(value: string, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${label} is required`);
    }

    const trimmed = value.trim().replace(/\\/g, '/');
    if (
      trimmed.includes('..') ||
      trimmed.includes('/') ||
      trimmed.startsWith('/') ||
      /^[a-zA-Z]:/.test(trimmed)
    ) {
      throw new Error(`${label} must be a single relative segment`);
    }
    if (trimmed.includes('\0')) {
      throw new Error(`${label} is invalid`);
    }

    return trimmed;
  }

  private assertInsideRoot(resolved: string): void {
    const root = this.rootPath.endsWith(path.sep) ? this.rootPath : `${this.rootPath}${path.sep}`;
    if (resolved !== this.rootPath && !resolved.startsWith(root)) {
      throw new Error('Resolved storage path escapes STORAGE_ROOT_PATH');
    }
  }
}
