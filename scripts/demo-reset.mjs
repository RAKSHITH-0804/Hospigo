/**
 * npm run demo:reset: drops and recreates the showcase database hospigo_demo, migrates it from the
 * final migrations, then runs the reference seed and the showcase seed (hospitals, history, refunds).
 * Only ever touches hospigo_demo. Takes several minutes (the history goes through the real routes).
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
    console.error('demo:reset stopped at: ' + label);
    process.exit(r.status ?? 1);
  }
}

run('drop and create hospigo_demo', 'node', ['scripts/db/create-demo-db.mjs', '--reset']);
// .env was rewritten by the step above: read it again
config({ path: path.join(root, '.env'), override: true });
const owner = process.env.DATABASE_URL_OWNER_DEMO;
if (!owner) {
  console.error('DATABASE_URL_OWNER_DEMO is missing in .env');
  process.exit(1);
}
run('migrate', 'npm', ['run', 'prisma:migrate', '-w', '@hospigo/api'], {
  DATABASE_URL_OWNER: owner,
});
run(
  'reference seed and showcase seed',
  'npm',
  ['run', 'prisma:seed-showcase', '-w', '@hospigo/api'],
  {
    NODE_ENV: 'development',
  },
);
console.log('demo:reset finished. Start the app on it with: npm run demo:stack');
