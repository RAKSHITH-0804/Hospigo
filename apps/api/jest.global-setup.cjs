/**
 * Jest globalSetup: rebuild hospigo_test from migrations, then reference seed.
 * Refuses unless BOTH app and owner URLs point at hospigo_test.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function globalSetup() {
  const apiRoot = __dirname;
  const repoRoot = path.resolve(apiRoot, '../..');
  const tsxCandidates = [
    path.join(apiRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  ];
  const tsxCli = tsxCandidates.find((p) => fs.existsSync(p));
  if (!tsxCli) {
    throw new Error('tsx CLI not found for hospigo_test rebuild');
  }
  const result = spawnSync(process.execPath, [tsxCli, 'scripts/rebuild-hospigo-test.ts'], {
    cwd: apiRoot,
    env: process.env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const out = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    throw new Error(`hospigo_test rebuild failed:\n${out.slice(0, 2000)}`);
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
};
