// Builds postman/collections/hospigo-2-2a-hq-without-entry.postman_collection.json (Phase 2.2, checkpoint 1).
// Run once: node scripts/make-postman-2-2a.mjs   (then prettier; the output is committed, this file too)
// It replaces the Phase 2.1 "Indigo access" collection: HQ never enters a hospital.
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
    '1 Login Super Admin (north main)',
    '/auth/hospital/login',
    { accessCode: 'demo-north-main', email: '{{superEmail}}', password: '{{superadminPassword}}' },
    'hSuper',
  ),
  login(
    '2 Login Receptionist (north main)',
    '/auth/hospital/login',
    { accessCode: 'demo-north-main', email: '{{receptionEmail}}', password: '{{staffPassword}}' },
    'hRecv',
  ),
  login(
    '3 Login HQ Admin',
    '/auth/hq/login',
    { email: '{{hqAdminEmail}}', password: '{{indigoPassword}}' },
    'hqAdmin',
  ),
  login(
    '4 Login HQ Staff',
    '/auth/hq/login',
    { email: '{{hqStaffEmail}}', password: '{{indigoPassword}}' },
    'hqStaff',
  ),
];

const noDoor = [
  req('5 The old entry route is gone (HQ Admin gets 404)', 'POST', '/auth/indigo/enter', {
    token: 'hqAdmin',
    body: { hospitalId: 'any' },
    tests: [status(404)],
  }),
  req('6 The old hospital list for entering is gone (404)', 'GET', '/auth/indigo/hospitals', {
    token: 'hqAdmin',
    tests: [status(404)],
  }),
  req('7 An HQ token is refused on a hospital route (401)', 'GET', '/patients', {
    token: 'hqAdmin',
    tests: [status(401)],
  }),
  req('8 An HQ token is refused on the OPD queue (401)', 'GET', '/opd/queue', {
    token: 'hqStaff',
    tests: [status(401)],
  }),
  req('9 A hospital token is refused on the HQ console (401)', 'GET', '/indigo/hospitals', {
    token: 'hSuper',
    tests: [status(401)],
  }),
  req('10 No token on the HQ console (401)', 'GET', '/indigo/hospitals', {
    tests: [status(401)],
  }),
  req('11 HQ Admin profile names the role HQ_ADMIN and has no hospital', 'GET', '/auth/me', {
    token: 'hqAdmin',
    tests: [
      status(200),
      "pm.test('HQ Admin', () => { const b = pm.response.json(); pm.expect(b.kind).to.eql('HQ'); pm.expect(b.roleCodes).to.eql(['HQ_ADMIN']); pm.expect(b.hospitalName).to.eql(null); });",
    ],
  }),
  req('12 HQ Staff profile names the role HQ_STAFF', 'GET', '/auth/me', {
    token: 'hqStaff',
    tests: [
      status(200),
      "pm.test('HQ Staff', () => pm.expect(pm.response.json().roleCodes).to.eql(['HQ_STAFF']));",
    ],
  }),
];

const hospitalSide = [
  req('13 The hospital staff list shows no HQ person', 'GET', '/staff?pageSize=100', {
    token: 'hSuper',
    tests: [
      status(200),
      "pm.test('no HQ person', () => { const t = pm.response.text(); pm.expect(t).to.not.include('(Indigo)'); pm.expect(t).to.not.include('indigo.invalid'); pm.expect(t).to.not.include('indigo.example.org'); });",
    ],
  }),
  req('14 The role list has only roles a hospital owns', 'GET', '/roles', {
    token: 'hSuper',
    tests: [
      status(200),
      "pm.test('no retired roles', () => { const codes = pm.response.json().items.map(r => r.code); pm.expect(codes).to.not.include('TENANT_ADMIN'); pm.expect(codes).to.not.include('INDIGO_EMPLOYEE'); pm.expect(codes).to.include('SUPER_ADMIN'); });",
    ],
  }),
  req('15 The Indigo access log screen is gone (404)', 'GET', '/indigo-access-log', {
    token: 'hSuper',
    tests: [status(404)],
  }),
  req('16 The Super Admin profile has no Indigo access permission', 'GET', '/auth/me', {
    token: 'hSuper',
    tests: [
      status(200),
      "pm.test('no indigo.access.read', () => pm.expect(pm.response.json().permissions).to.not.include('indigo.access.read'));",
      "pm.test('Super Admin role code', () => pm.expect(pm.response.json().roleCodes).to.include('SUPER_ADMIN'));",
    ],
  }),
];

const hqConsole = [
  req(
    '17 HQ Admin sees the hospitals (with access codes) and can manage',
    'GET',
    '/indigo/hospitals',
    {
      token: 'hqAdmin',
      tests: [
        status(200),
        "pm.test('HQ Admin overview', () => { const b = pm.response.json(); pm.expect(b.canManage).to.eql(true); pm.expect(b.items.length).to.be.above(0); });",
      ],
    },
  ),
  req(
    '18 HQ Staff sees only assigned hospitals, no access codes, cannot manage',
    'GET',
    '/indigo/hospitals',
    {
      token: 'hqStaff',
      tests: [
        status(200),
        "pm.test('HQ Staff overview', () => { const b = pm.response.json(); pm.expect(b.canManage).to.eql(false); pm.expect(pm.response.text()).to.not.include('accessCode'); });",
      ],
    },
  ),
  req('19 HQ Staff cannot onboard a hospital (403)', 'POST', '/indigo/hospitals', {
    token: 'hqStaff',
    body: {},
    tests: [status(403)],
  }),
  req('20 HQ Staff cannot manage HQ Staff (403)', 'GET', '/indigo/employees', {
    token: 'hqStaff',
    tests: [status(403)],
  }),
  req('21 HQ Admin lists HQ Staff', 'GET', '/indigo/employees', {
    token: 'hqAdmin',
    tests: [status(200)],
  }),
];

const collection = {
  info: {
    name: 'Hospigo 2.2a: HQ without entry (HQ never enters a hospital)',
    description:
      'Phase 2.2, checkpoint 1. Needs the Hospigo Local environment (baseUrl, staffPassword, superadminPassword, indigoPassword) and the test seed with the HQ demo people (SEED_INDIGO_PASSWORD): hq.admin@indigo.example.org and hq.staff@indigo.example.org. Changes nothing (reads and refusals only).',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://127.0.0.1:3000' },
    { key: 'superEmail', value: 'superadmin@demo-north.example.test' },
    { key: 'receptionEmail', value: 'receptionist1@demo-north.example.test' },
    { key: 'hqAdminEmail', value: 'hq.admin@indigo.example.org' },
    { key: 'hqStaffEmail', value: 'hq.staff@indigo.example.org' },
  ],
  item: [
    { name: '0 Setup', item: setup },
    { name: '1 HQ has no door into a hospital', item: noDoor },
    { name: '2 The hospital sees no HQ trace', item: hospitalSide },
    { name: '3 The HQ console (counts and setup only)', item: hqConsole },
  ],
};
const out = path.resolve(
  'postman/collections/hospigo-2-2a-hq-without-entry.postman_collection.json',
);
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
console.log('written', out);
