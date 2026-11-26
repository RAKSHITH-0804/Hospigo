import {
  behindMessage,
  compareMigrations,
  MIGRATE_COMMAND,
  migrationFolders,
} from './migrations-check';

describe('migrations check', () => {
  it('up to date: every folder of the repo is applied', () => {
    expect(compareMigrations(['a', 'b'], ['a', 'b'])).toEqual({
      status: 'ok',
      missing: [],
      extra: [],
    });
  });

  it('behind: names the missing migrations, oldest first', () => {
    const state = compareMigrations(['a'], ['a', 'c', 'b']);
    expect(state.status).toBe('behind');
    expect(state.missing).toEqual(['b', 'c']);
  });

  it('an unknown extra migration in the database is reported but does not count as behind', () => {
    const state = compareMigrations(['a', 'z'], ['a']);
    expect(state).toEqual({ status: 'ok', missing: [], extra: ['z'] });
  });

  it('the message names the missing migrations and the exact command', () => {
    const text = behindMessage(['20261129095000_x']);
    expect(text).toContain('20261129095000_x');
    expect(text).toContain(MIGRATE_COMMAND);
    expect(MIGRATE_COMMAND).toBe('npm run prisma:migrate -w @hospigo/api');
  });

  it('reads the real migration folders of the repo', () => {
    const folders = migrationFolders();
    expect(folders.length).toBeGreaterThan(10);
    expect(folders).toContain('20261129095000_print_library_terminology');
  });
});
