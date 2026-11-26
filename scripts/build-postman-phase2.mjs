// Builds ONE Postman collection that runs every Phase 2 collection in order:
//   node scripts/build-postman-phase2.mjs
// Each committed collection in postman/collections/ becomes one folder. Nothing else is changed in
// the requests. Two things are added: a login throttle (the login routes allow about 20 a minute per
// address) and per-collection names for variables that two collections give different values.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('postman', 'collections');
const OUT = 'hospigo-phase2-all.postman_collection.json';
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.postman_collection.json') && f !== OUT)
  .sort();

const parts = files.map((f) => ({
  file: f,
  tag: f.replace('hospigo-', '').replace('.postman_collection.json', ''),
  json: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')),
}));

// variable keys that have more than one value across the collections
const seen = new Map();
const conflicts = new Set();
for (const p of parts) {
  for (const v of p.json.variable ?? []) {
    if (seen.has(v.key) && seen.get(v.key) !== v.value) conflicts.add(v.key);
    seen.set(v.key, v.value);
  }
}

const variables = new Map();
const folders = parts.map((p) => {
  let text = JSON.stringify({ name: p.json.info.name, item: p.json.item });
  for (const v of p.json.variable ?? []) {
    let key = v.key;
    if (conflicts.has(key)) {
      key = `${key}_${p.tag.replace(/[^A-Za-z0-9]/g, '_')}`;
      text = text.split(`{{${v.key}}}`).join(`{{${key}}}`);
    }
    variables.set(key, v.value);
  }
  const folder = JSON.parse(text);
  return { name: `${p.tag}: ${folder.name}`, item: folder.item };
});

const throttle = [
  '// Login, refresh and switch-branch share one limit (about 20 a minute per address).',
  '// Keep under 14 in any 62 seconds; setTimeout holds the request back.',
  'const m = pm.request.method;',
  "if (m !== 'GET' && pm.request.url.toString().indexOf('/auth/') >= 0) {",
  '  const now = Date.now();',
  "  const times = JSON.parse(pm.collectionVariables.get('_authTimes') || '[]').filter(",
  '    (t) => now - t < 62000,',
  '  );',
  '  let wait = 0;',
  '  if (times.length >= 14) {',
  '    wait = 62000 - (now - times[times.length - 14]) + 500;',
  '  }',
  '  times.push(now + wait);',
  "  pm.collectionVariables.set('_authTimes', JSON.stringify(times));",
  '  if (wait > 0) {',
  '    setTimeout(() => {}, wait);',
  '  }',
  '}',
];

const all = {
  info: {
    name: 'Hospigo Phase 2: all OPD tests',
    description:
      'Every Phase 2 collection (3d to 8c) in order, one folder each. Needs the Hospigo Local environment (baseUrl is set here; passwords come from the environment). Logins are throttled automatically, so a full run takes a few minutes. Built by scripts/build-postman-phase2.mjs; do not edit by hand.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: throttle } }],
  variable: [...variables].map(([key, value]) => ({ key, value })),
  item: folders,
};

fs.writeFileSync(path.join(dir, OUT), JSON.stringify(all, null, 2) + '\n');
let requests = 0;
const count = (items) => {
  for (const i of items) {
    if (i.item) count(i.item);
    else requests += 1;
  }
};
count(folders);
console.log(
  `${OUT}: ${folders.length} folders, ${requests} requests, conflicts: ${[...conflicts]}`,
);
