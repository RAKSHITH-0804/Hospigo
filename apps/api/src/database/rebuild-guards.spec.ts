import {
  assertCurrentDatabaseIsHospigoTest,
  assertLocalHost,
  assertNoNonTestHospitals,
  assertRebuildUrlPair,
  type QueryClient,
} from './rebuild-guards';

/** Fake URLs for unit tests only — never connected; no passwords. */
function fakeUrl(opts: { host: string; port?: string; database: string; user?: string }): string {
  const port = opts.port ?? '5432';
  const user = opts.user ?? 'u';
  return `postgresql://${user}:secret@${opts.host}:${port}/${opts.database}`;
}

describe('rebuild-hospigo-test guards (no destructive steps)', () => {
  it('refuses wrong database name', () => {
    const app = fakeUrl({ host: '127.0.0.1', database: 'hospigo' });
    const owner = fakeUrl({ host: '127.0.0.1', database: 'hospigo' });
    expect(() => assertRebuildUrlPair(app, owner)).toThrow(/hospigo_test/);
  });

  it('refuses non-local host', () => {
    expect(() => assertLocalHost('db.example.com', 'app URL')).toThrow(/non-local host/);
    const app = fakeUrl({ host: '10.0.0.5', database: 'hospigo_test' });
    const owner = fakeUrl({ host: '10.0.0.5', database: 'hospigo_test' });
    expect(() => assertRebuildUrlPair(app, owner)).toThrow(/non-local host/);
  });

  it('refuses mismatched app and owner URLs', () => {
    const app = fakeUrl({ host: '127.0.0.1', port: '5432', database: 'hospigo_test' });
    const ownerDiffPort = fakeUrl({ host: '127.0.0.1', port: '5433', database: 'hospigo_test' });
    expect(() => assertRebuildUrlPair(app, ownerDiffPort)).toThrow(/same host, port, and database/);

    const ownerDiffDb = fakeUrl({ host: '127.0.0.1', port: '5432', database: 'other_test' });
    expect(() => assertRebuildUrlPair(app, ownerDiffDb)).toThrow();
  });

  it('refuses when connected database is not hospigo_test', async () => {
    const client: QueryClient = {
      query: async () => ({ rows: [{ current_database: 'hospigo' }] }),
    };
    await expect(assertCurrentDatabaseIsHospigoTest(client, 'owner connection')).rejects.toThrow(
      /hospigo_test/,
    );
  });

  it('refuses when a non-test hospital is present', async () => {
    const client: QueryClient = {
      query: async (sql: string) => {
        if (sql.includes('information_schema')) {
          return { rows: [{ exists: true }] };
        }
        return { rows: [{ c: '1' }] };
      },
    };
    await expect(assertNoNonTestHospitals(client)).rejects.toThrow(/is_test = false/);
  });

  it('allows matching local hospigo_test URL pair (sync only)', () => {
    const app = fakeUrl({ host: 'localhost', database: 'hospigo_test' });
    const owner = fakeUrl({ host: 'localhost', database: 'hospigo_test', user: 'owner' });
    expect(() => assertRebuildUrlPair(app, owner)).not.toThrow();
  });
});
