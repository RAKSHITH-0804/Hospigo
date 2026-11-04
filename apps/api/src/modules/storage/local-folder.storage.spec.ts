import { createReadStream } from 'fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { LocalFolderStorageDriver } from './local-folder.storage';

describe('LocalFolderStorageDriver', () => {
  let root: string;
  let storage: LocalFolderStorageDriver;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'hospigo-storage-'));
    storage = new LocalFolderStorageDriver(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('puts, gets, exists, and deletes an object under the tenant prefix', async () => {
    const tenant = 'tenant-a';
    const key = 'reports/note.txt';
    const payload = Buffer.from('hello-storage');

    await storage.put(tenant, key, payload);
    await expect(storage.exists(tenant, key)).resolves.toBe(true);

    const onDisk = path.join(root, tenant, 'reports', 'note.txt');
    await expect(readFile(onDisk)).resolves.toEqual(payload);

    const stream = await storage.get(tenant, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello-storage');

    await storage.delete(tenant, key);
    await expect(storage.exists(tenant, key)).resolves.toBe(false);
  });

  it('accepts a readable stream on put', async () => {
    const sourceFile = path.join(root, 'source.bin');
    await writeFile(sourceFile, Buffer.from('streamed'));
    await storage.put('tenant-b', 'uploads/source.bin', createReadStream(sourceFile));
    await expect(
      readFile(path.join(root, 'tenant-b', 'uploads', 'source.bin'), 'utf8'),
    ).resolves.toBe('streamed');
  });

  it('rejects path traversal in keys', async () => {
    await expect(storage.put('tenant-a', '../escape.txt', Buffer.from('x'))).rejects.toThrow(
      /"\.\."/,
    );
    await expect(storage.put('tenant-a', 'ok/../../escape.txt', Buffer.from('x'))).rejects.toThrow(
      /"\.\."/,
    );
  });

  it('rejects absolute keys and drive letters', async () => {
    await expect(storage.put('tenant-a', '/etc/passwd', Buffer.from('x'))).rejects.toThrow(
      /relative path/,
    );
    await expect(
      storage.put('tenant-a', 'C:\\Windows\\system.ini', Buffer.from('x')),
    ).rejects.toThrow(/relative path/);
  });

  it('keeps tenant prefixes isolated', async () => {
    await storage.put('tenant-a', 'shared.txt', Buffer.from('a'));
    await storage.put('tenant-b', 'shared.txt', Buffer.from('b'));

    await expect(readFile(path.join(root, 'tenant-a', 'shared.txt'), 'utf8')).resolves.toBe('a');
    await expect(readFile(path.join(root, 'tenant-b', 'shared.txt'), 'utf8')).resolves.toBe('b');
    await expect(storage.exists('tenant-a', 'shared.txt')).resolves.toBe(true);
    await expect(storage.exists('tenant-c', 'shared.txt')).resolves.toBe(false);
  });

  it('reports health ok when the root is writable', async () => {
    await expect(storage.health()).resolves.toBeUndefined();
  });

  it('reports health fail when the root is not writable', async () => {
    const blocked = path.join(root, '.health');
    await writeFile(blocked, 'not-a-directory');
    await expect(storage.health()).rejects.toThrow();
  });

  it('rejects unsafe tenant prefixes', async () => {
    await expect(storage.put('../other', 'file.txt', Buffer.from('x'))).rejects.toThrow(
      /tenantPrefix/,
    );
    await expect(storage.put('a/b', 'file.txt', Buffer.from('x'))).rejects.toThrow(/tenantPrefix/);
  });

  it('can be constructed against a nested existing root', async () => {
    const nested = path.join(root, 'nested-root');
    await mkdir(nested, { recursive: true });
    const nestedStorage = new LocalFolderStorageDriver(nested);
    await nestedStorage.put('tenant-a', 'x.txt', Buffer.from('nested'));
    await expect(readFile(path.join(nested, 'tenant-a', 'x.txt'), 'utf8')).resolves.toBe('nested');
  });
});
