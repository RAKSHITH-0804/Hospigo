/**
 * npm run dev:reset: drops and recreates the development database hospigo, migrates it from the
 * migrations, then runs the reference seed and the showcase seed. Afterwards hospigo holds ONLY
 * Nandavana Multispeciality Hospital and Sagarika Heart and Eye Centre (all roles, history, approvals)
 * plus the HQ Admin and HQ Staff. Never touches hospigo_test. Takes several minutes (the history goes through the real routes).
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
    console.error('dev:reset stopped at: ' + label);
    process.exit(r.status ?? 1);
  }
}

run('drop and create the development database hospigo', 'node', ['scripts/db/recreate-dev-db.mjs']);
run('migrate', 'npm', ['run', 'prisma:migrate', '-w', '@hospigo/api']);
run(
  'reference seed and showcase seed',
  'npm',
  ['run', 'prisma:seed-showcase', '-w', '@hospigo/api'],
  {
    NODE_ENV: 'development',
  },
);
console.log(
  'dev:reset finished. Start the servers with: npm run dev -w @hospigo/api and npm run dev -w @hospigo/web',
);
