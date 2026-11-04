import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { collectGrantAudit, requireTestDatabaseUrl } from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

/**
 * Suite-start emptiness is enforced in Jest globalSetup (rebuild + assertTenantTablesEmpty).
 * This file proves the rebuild ran and that grants/policies match after it.
 * (Jest does not guarantee this file runs before other suites, so we do not re-assert
 * empty tenant tables here — that would race with fixtures other files create.)
 */
describe('hospigo_test clean start', () => {
  requireTestDatabaseUrl();

  it('globalSetup rebuild sentinel exists (tenant tables were empty at rebuild time)', () => {
    const sentinel = path.resolve(__dirname, '../../.hospigo-test-rebuilt');
    expect(fs.existsSync(sentinel)).toBe(true);
    const body = JSON.parse(fs.readFileSync(sentinel, 'utf8')) as {
      tenantTablesEmpty: boolean;
      tableCount: number;
      policyCount: number;
    };
    expect(body.tenantTablesEmpty).toBe(true);
    expect(body.tableCount).toBeGreaterThan(10);
    expect(body.policyCount).toBeGreaterThan(10);
  });

  it('schema grants and policies exist after rebuild (grant audit)', async () => {
    const audit = await collectGrantAudit();
    expect(audit.schema).toMatchObject({
      app_usage: true,
      hq_usage: true,
      security_create: true,
      owner_create: true,
    });
    expect(audit.tableCount).toBeGreaterThan(10);
    expect(audit.policyCount).toBeGreaterThan(10);
    const importTypes = audit.tables.find((t) => t.table_name === 'import_types') as {
      app_select: boolean;
      app_insert: boolean;
      app_delete: boolean;
      hq_select: boolean;
    };
    expect(importTypes).toMatchObject({
      app_select: true,
      app_insert: false,
      app_delete: false,
      hq_select: false,
    });
  });
});
