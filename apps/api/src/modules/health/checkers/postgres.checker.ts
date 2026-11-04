import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import { CHECK_TIMEOUT_MS, delay, ServiceChecker, withTimeout } from '../service-checker';

@Injectable()
export class PostgresChecker extends ServiceChecker {
  constructor(private readonly config: ConfigService) {
    super();
  }

  protected override async probe(): Promise<void> {
    const client = new Client({
      connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
      connectionTimeoutMillis: CHECK_TIMEOUT_MS,
      query_timeout: CHECK_TIMEOUT_MS,
      statement_timeout: CHECK_TIMEOUT_MS,
    });
    client.on('error', () => undefined);

    const operation = (async () => {
      await client.connect();
      await client.query('SELECT 1');
    })();

    try {
      await withTimeout(operation, CHECK_TIMEOUT_MS, 'postgres');
    } finally {
      await Promise.race([client.end().catch(() => undefined), delay(500)]);
    }
  }
}
