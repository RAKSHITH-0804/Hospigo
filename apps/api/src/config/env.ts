import fs from 'fs';
import path from 'path';

export interface ApiEnv {
  NODE_ENV: 'development' | 'production' | 'test';
  API_PORT: number;
  DATABASE_URL: string;
  DATABASE_URL_OWNER: string;
  REDIS_URL: string;
  STORAGE_ROOT_PATH: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
  /** Max page size for patient search (server-enforced). */
  PATIENT_SEARCH_MAX_PAGE_SIZE: number;
  /** Comma-separated browser origins. Unset means CORS stays off. */
  CORS_ORIGIN: string | undefined;
}

export function envFilePath(): string[] {
  return [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ];
}

export function validateEnv(config: Record<string, unknown>): ApiEnv {
  const errors: string[] = [];
  const nodeEnv = parseNodeEnv(config['NODE_ENV'], errors);
  const apiPort = parsePort(config['API_PORT'], 'API_PORT', errors);
  const databaseUrl = parseDatabaseUrl(config['DATABASE_URL'], 'DATABASE_URL', errors);
  const databaseUrlOwner = parseDatabaseUrl(
    config['DATABASE_URL_OWNER'],
    'DATABASE_URL_OWNER',
    errors,
  );
  const redisUrl = requireText(config, 'REDIS_URL', errors);
  const storageRootPath = parseStorageRoot(config['STORAGE_ROOT_PATH'], errors);
  const smtpHost = requireText(config, 'SMTP_HOST', errors);
  const smtpPort = parsePort(config['SMTP_PORT'], 'SMTP_PORT', errors);
  const smtpUser = requireText(config, 'SMTP_USER', errors);
  const smtpPassword = requireText(config, 'SMTP_PASSWORD', errors);
  const smtpFrom = requireText(config, 'SMTP_FROM', errors);
  const patientSearchMaxPageSize = parseOptionalPortLike(
    config['PATIENT_SEARCH_MAX_PAGE_SIZE'],
    'PATIENT_SEARCH_MAX_PAGE_SIZE',
    50,
    errors,
  );
  const corsOrigin = optionalText(config, 'CORS_ORIGIN', errors);

  if (redisUrl !== '' && !/^rediss?:\/\//.test(redisUrl)) {
    errors.push('REDIS_URL must start with redis:// or rediss://');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return {
    NODE_ENV: nodeEnv,
    API_PORT: apiPort,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_OWNER: databaseUrlOwner,
    REDIS_URL: redisUrl,
    STORAGE_ROOT_PATH: storageRootPath,
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_USER: smtpUser,
    SMTP_PASSWORD: smtpPassword,
    SMTP_FROM: smtpFrom,
    PATIENT_SEARCH_MAX_PAGE_SIZE: patientSearchMaxPageSize,
    CORS_ORIGIN: corsOrigin,
  };
}

export function assertStorageRoot(rootPath: string): string {
  if (rootPath.trim() === '') {
    throw new Error('STORAGE_ROOT_PATH is required');
  }
  if (!path.isAbsolute(rootPath)) {
    throw new Error('STORAGE_ROOT_PATH must be an absolute path');
  }

  const resolved = path.resolve(rootPath);
  fs.mkdirSync(resolved, { recursive: true });

  try {
    fs.accessSync(resolved, fs.constants.W_OK);
    const probe = path.join(resolved, `.write-check-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`STORAGE_ROOT_PATH is not writable: ${message}`);
  }

  return resolved;
}

export function assertPostgresUrl(value: string, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${key} is required`);
  }
  const trimmed = value.trim();
  if (!/^postgres(ql)?:\/\//.test(trimmed)) {
    throw new Error(`${key} must start with postgres:// or postgresql://`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${key} is not a valid URL`);
  }
  if (!parsed.hostname) {
    throw new Error(`${key} must include a hostname`);
  }
  if (!parsed.pathname || parsed.pathname === '/') {
    throw new Error(`${key} must include a database name`);
  }
  if (!parsed.username) {
    throw new Error(`${key} must include a username`);
  }
  return trimmed;
}

function parseDatabaseUrl(value: unknown, key: string, errors: string[]): string {
  try {
    if (typeof value !== 'string') {
      throw new Error(`${key} is required`);
    }
    return assertPostgresUrl(value, key);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return '';
  }
}

function parseStorageRoot(value: unknown, errors: string[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push('STORAGE_ROOT_PATH is required');
    return '';
  }

  try {
    return assertStorageRoot(value.trim());
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return '';
  }
}

function parseNodeEnv(value: unknown, errors: string[]): ApiEnv['NODE_ENV'] {
  if (value === undefined || value === '') {
    return 'development';
  }
  if (value === 'development' || value === 'production' || value === 'test') {
    return value;
  }
  errors.push('NODE_ENV must be development, production, or test');
  return 'development';
}

function optionalText(
  config: Record<string, unknown>,
  key: string,
  errors: string[],
): string | undefined {
  const value = config[key];
  if (value === undefined || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    errors.push(`${key} must be a string`);
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function requireText(config: Record<string, unknown>, key: string, errors: string[]): string {
  const value = config[key];
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${key} is required`);
    return '';
  }
  return value.trim();
}

function parsePort(value: unknown, key: string, errors: string[]): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    const port = Number(value.trim());
    if (port >= 1 && port <= 65535) {
      return port;
    }
  }
  errors.push(`${key} must be an integer from 1 to 65535`);
  return 0;
}

function parseOptionalPortLike(
  value: unknown,
  key: string,
  fallback: number,
  errors: string[],
): number {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500) {
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (n >= 1 && n <= 500) {
      return n;
    }
  }
  errors.push(`${key} must be an integer from 1 to 500`);
  return fallback;
}
