// Builds postman/collections/hospigo-2-2b-hq-without-entry.postman_collection.json (Phase 2.2, checkpoint 2).
// Run once: node scripts/make-postman-2-2b.mjs   (then prettier; the output is committed, this file too)
// HQ console: tick-box permissions, counts-only monitoring, health, activity log.
import fs from 'node:fs';
import path from 'node:path';

const url = (p) => ({
  raw: `{{baseUrl}}${p}`,
  host: ['{{baseUrl}}'],
  path: p.replace(/\?.*$/, '').split('/').filter(Boolean),
  ...(p.includes('?')
    ? {
        query: p
          .split('?')[1]
          .split('&')
          .map((kv) => ({ key: kv.split('=')[0], value: kv.split('=')[1] })),
      }
    : {}),
});
function req(name, method, p, { token, body, tests = [] } = {}) {
  const header = [];
  if (body !== undefined) header.push({ key: 'Content-Type', value: 'application/json' });
  if (token) header.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  return {
    name,
    request: {
      method,
      header,
      url: url(p),
      ...(body !== undefined
        ? {
            body: {
              mode: 'raw',
              raw: JSON.stringify(body),
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
    },
    event: [{ listen: 'test', script: { type: 'text/javascript', exec: tests } }],
  };
}
const status = (n) => `pm.test('${n}', () => pm.response.to.have.status(${n}));`;
const login = (name, p, bodyObj, save) =>
  req(name, 'POST', p, {
    body: bodyObj,
    tests: [status(200), `pm.collectionVariables.set('${save}', pm.response.json().accessToken);`],
  });

const setup = [
  login(
    '1 Login HQ Admin',
    '/auth/hq/login',
    { email: '{{hqAdminEmail}}', password: '{{indigoPassword}}' },
    'hqAdmin',
  ),
  login(
    '2 Login HQ Staff',
    '/auth/hq/login',
    { email: '{{hqStaffEmail}}', password: '{{indigoPassword}}' },
    'hqStaff',
  ),
  login(
    '3 Login Super Admin (north main)',
    '/auth/hospital/login',
    { accessCode: 'demo-north-main', email: '{{superEmail}}', password: '{{superadminPassword}}' },
    'hSuper',
  ),
  req('4 HQ Admin finds north and HQ Staff', 'GET', '/indigo/hospitals', {
    token: 'hqAdmin',
    tests: [
      status(200),
      "const north = pm.response.json().items.find(h => h.code === 'DEMO_NORTH');",
      "pm.test('north is listed', () => pm.expect(north).to.exist);",
      "pm.collectionVariables.set('northId', north.id);",
    ],
  }),
  req('5 HQ Admin lists HQ Staff', 'GET', '/indigo/employees', {
    token: 'hqAdmin',
    tests: [
      status(200),
      "const staff = pm.response.json().items.find(e => e.email === pm.collectionVariables.get('hqStaffEmail'));",
      "pm.test('staff found', () => pm.expect(staff).to.exist);",
      "pm.collectionVariables.set('staffId', staff.id);",
    ],
  }),
];

const ticks = [
  req(
    '6 An unknown permission is refused (400)',
    'PUT',
    '/indigo/employees/{{staffId}}/permissions',
    {
      token: 'hqAdmin',
      body: { permissions: ['hq.nope'] },
      tests: [status(400)],
    },
  ),
  req(
    '7 HQ Staff cannot tick their own permissions (403)',
    'PUT',
    '/indigo/employees/{{staffId}}/permissions',
    {
      token: 'hqStaff',
      body: { permissions: ['hq.print'] },
      tests: [status(403)],
    },
  ),
  req(
    '8 HQ Admin gives HQ Staff: view hospitals and monitor only',
    'PUT',
    '/indigo/employees/{{staffId}}/permissions',
    {
      token: 'hqAdmin',
      body: { permissions: ['hq.hospitals.view', 'hq.monitor'] },
      tests: [status(200)],
    },
  ),
];

const monitoring = [
  req('9 HQ Staff reads counts for the assigned hospitals', 'GET', '/indigo/monitoring', {
    token: 'hqStaff',
    tests: [
      status(200),
      "pm.test('counts only', () => { const t = pm.response.text(); pm.expect(t).to.not.match(/patient|amount|paise/i); pm.response.json().items.forEach(i => pm.expect(Object.keys(i).sort()).to.eql(['activeUsers30d','hospitalId','lastActivity','visits30d','visits7d','visitsToday'])); });",
    ],
  }),
  req('10 One system status', 'GET', '/indigo/health', {
    token: 'hqStaff',
    tests: [
      status(200),
      "pm.test('one status', () => pm.expect(pm.response.json()).to.have.keys(['status','checkedAt','api','database','storage','migrations']));",
    ],
  }),
  req('11 HQ Staff cannot read the activity log (403)', 'GET', '/indigo/activity', {
    token: 'hqStaff',
    tests: [status(403)],
  }),
  req('12 HQ Admin reads the activity log', 'GET', '/indigo/activity', {
    token: 'hqAdmin',
    tests: [status(200)],
  }),
  req('13 A hospital token is refused (401)', 'GET', '/indigo/monitoring', {
    token: 'hSuper',
    tests: [status(401)],
  }),
];

const noTick = [
  req(
    '14 HQ Staff without the tick cannot list Super Admins (403)',
    'GET',
    '/indigo/hospitals/{{northId}}/super-admins',
    {
      token: 'hqStaff',
      tests: [status(403)],
    },
  ),
  req(
    '15 HQ Staff without the tick cannot set a design (403)',
    'PUT',
    '/indigo/hospitals/{{northId}}/print-design',
    {
      token: 'hqStaff',
      body: { templateId: 'x' },
      tests: [status(403)],
    },
  ),
  req(
    '16 HQ Admin lists the Super Admins of north',
    'GET',
    '/indigo/hospitals/{{northId}}/super-admins',
    {
      token: 'hqAdmin',
      tests: [
        status(200),
        "pm.test('a list', () => pm.expect(pm.response.json().items).to.be.an('array'));",
      ],
    },
  ),
  req(
    '17 HQ Admin sees which designs are active in north',
    'GET',
    '/indigo/hospitals/{{northId}}/print',
    {
      token: 'hqAdmin',
      tests: [
        status(200),
        "pm.test('shape', () => pm.expect(pm.response.json()).to.have.keys(['designs','hasLogo']));",
      ],
    },
  ),
];

const collection = {
  info: {
    name: 'Hospigo 2.2b: HQ console (tick-boxes, monitoring, activity)',
    description:
      'Phase 2.2, checkpoint 2. Needs the Hospigo Local environment (baseUrl, superadminPassword, indigoPassword) and the test seed with the HQ demo people. Changes only the HQ Staff tick-boxes (set back to view + monitor).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://127.0.0.1:3000' },
    { key: 'superEmail', value: 'superadmin@demo-north.example.test' },
    { key: 'hqAdminEmail', value: 'hq.admin@indigo.example.org' },
    { key: 'hqStaffEmail', value: 'hq.staff@indigo.example.org' },
  ],
  item: [
    { name: '0 Setup', item: setup },
    { name: '1 Tick-box permissions', item: ticks },
    { name: '2 Counts, health and activity', item: monitoring },
    { name: '3 Without the tick', item: noTick },
  ],
};
const out = path.resolve('postman/collections/hospigo-2-2b-hq-console.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
console.log('written', out);
