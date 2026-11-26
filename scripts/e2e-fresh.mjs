/**
 * npm run e2e:fresh: rebuilds hospigo_test from the migrations (refuses anything that is not a test
 * database) and seeds the demo fixtures, so the browser tests start from a clean database and nothing
 * left by Jest or Newman can break them. Then: npm run e2e:stack (own terminal) and npm run e2e.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(root, '.env') });
function run(label, cmd, args, env = {}) {
  console.log('--- ' + label);
  const r = spawnSync(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    console.error('e2e:fresh stopped at: ' + label);
    process.exit(r.status ?? 1);
  }
}
run('rebuild hospigo_test', 'npx', ['tsx', 'apps/api/scripts/rebuild-hospigo-test.ts']);
run('seed the demo fixtures', 'npm', ['run', 'prisma:seed', '-w', '@hospigo/api'], {
  NODE_ENV: 'development',
  DATABASE_URL_OWNER: process.env.DATABASE_URL_OWNER_TEST,
  SEED_INDIGO_PASSWORD: process.env.SEED_INDIGO_PASSWORD || process.env.SEED_STAFF_PASSWORD,
});
console.log('Clean. Now: npm run e2e:stack (own terminal), then npm run e2e.');
