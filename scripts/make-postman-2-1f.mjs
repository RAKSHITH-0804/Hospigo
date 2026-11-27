// Builds postman/collections/hospigo-2-1f-library.postman_collection.json (Step 2.1f).
// Run once: node scripts/make-postman-2-1f.mjs   (then prettier; the output is committed, this file too)
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
function req(name, method, p, { token, body, tests = [], raw } = {}) {
  const header = [];
  if (body !== undefined || raw !== undefined)
    header.push({ key: 'Content-Type', value: 'application/json' });
  if (token) header.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  return {
    name,
    request: {
      method,
      header,
      url: url(p),
      ...(body !== undefined || raw !== undefined
        ? {
            body: {
              mode: 'raw',
              raw: raw ?? JSON.stringify(body),
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
    'Login SuperAdmin (north main)',
    '/auth/hospital/login',
    { accessCode: 'demo-north-main', email: '{{superEmail}}', password: '{{superadminPassword}}' },
    'xSuper',
  ),
  login(
    'Login Branch Admin (north main)',
    '/auth/hospital/login',
    {
      accessCode: 'demo-north-main',
      email: 'branchadmin@demo-north.example.test',
      password: '{{branchAdminPassword}}',
    },
    'xBranchAdmin',
  ),
  login(
    'Login Receptionist (north main)',
    '/auth/hospital/login',
    { accessCode: 'demo-north-main', email: '{{receptionEmail}}', password: '{{staffPassword}}' },
    'xRecv',
  ),
  login(
    'Login HQ Admin',
    '/auth/hq/login',
    { email: '{{hqAdminEmail}}', password: '{{indigoPassword}}' },
    'xHqOwner',
  ),
  login(
    'Login HQ Staff',
    '/auth/hq/login',
    { email: '{{hqStaffEmail}}', password: '{{indigoPassword}}' },
    'xHqEmployee',
  ),
  req('The HQ Admin finds north and south', 'GET', '/indigo/hospitals', {
    token: 'xHqOwner',
    tests: [
      status(200),
      'const items = pm.response.json().items;',
      "const north = items.find(h => h.code === 'DEMO_NORTH'); const south = items.find(h => h.code === 'DEMO_SOUTH');",
      "pm.test('both demo hospitals are listed', () => { pm.expect(north).to.exist; pm.expect(south).to.exist; });",
      "pm.collectionVariables.set('xNorthId', north.id); pm.collectionVariables.set('xSouthId', south.id);",
      'const main = north.branches.find(b => b.isMain);',
      "pm.collectionVariables.set('xNorthBranchId', main.id); pm.collectionVariables.set('xNorthBranchModulesJson', JSON.stringify(main.modules));",
    ],
  }),
];

const library = [
  req('Only the Owner: an Employee gets 403', 'GET', '/indigo/library', {
    token: 'xHqEmployee',
    tests: [status(403)],
  }),
  req('A hospital token gets 401', 'GET', '/indigo/library', {
    token: 'xSuper',
    tests: [status(401)],
  }),
  req('The HQ Admin adds the designed samples', 'POST', '/indigo/library/samples', {
    token: 'xHqOwner',
    body: {},
    tests: [
      status(200),
      "pm.test('added is a number', () => pm.expect(pm.response.json().added).to.be.a('number'));",
    ],
  }),
  req('Pressing it again adds nothing', 'POST', '/indigo/library/samples', {
    token: 'xHqOwner',
    body: {},
    tests: [
      status(200),
      "pm.test('nothing new', () => pm.expect(pm.response.json().added).to.eql(0));",
    ],
  }),
  req('The library holds two to three templates per document', 'GET', '/indigo/library', {
    token: 'xHqOwner',
    tests: [
      status(200),
      'const t = pm.response.json().templates;',
      "for (const d of ['REGISTRATION_SLIP','RECEIPT','PRESCRIPTION','PATIENT_REPORT','PATIENT_CARD']) { const n = t.filter(x => x.docType === d && !x.retired && x.key !== undefined && /^(slip|bill|rx|report|card)-/.test(x.key)).length; pm.test(d + ' has 2 to 3 samples', () => pm.expect(n).to.be.within(2, 3)); }",
      "const bill = t.find(x => x.key === 'bill-classic'); const bill2 = t.find(x => x.key === 'bill-modern');",
      "pm.collectionVariables.set('xTplBill', bill.id); pm.collectionVariables.set('xTplBill2', bill2.id);",
    ],
  }),
  req('A copy under a new name', 'POST', '/indigo/library/templates', {
    token: 'xHqOwner',
    body: { copyOf: '{{xTplBill}}', name: 'Postman copy {{$timestamp}}' },
    tests: [status(201), "pm.collectionVariables.set('xTplCopy', pm.response.json().id);"],
  }),
  req('A bad request is refused', 'POST', '/indigo/library/templates', {
    token: 'xHqOwner',
    body: { docType: 'NOPE', name: 'x' },
    tests: [status(400)],
  }),
  req('The copy is taken out again', 'POST', '/indigo/library/templates/{{xTplCopy}}/retire', {
    token: 'xHqOwner',
    body: {},
    tests: [status(200)],
  }),
  req('The HQ Admin assigns two bills to north', 'PUT', '/indigo/hospitals/{{xNorthId}}/library', {
    token: 'xHqOwner',
    body: { templateIds: ['{{xTplBill}}', '{{xTplBill2}}'], logoIds: [] },
    tests: [status(200)],
  }),
  req('An unknown template is refused', 'PUT', '/indigo/hospitals/{{xNorthId}}/library', {
    token: 'xHqOwner',
    body: { templateIds: ['nope'], logoIds: [] },
    tests: [status(400)],
  }),
];

const chooser = [
  req('The SuperAdmin sees exactly the two assigned bills', 'GET', '/print-library', {
    token: 'xSuper',
    tests: [
      status(200),
      'const b = pm.response.json();',
      "pm.test('two bills', () => pm.expect(b.templates.length).to.eql(2));",
      "pm.test('can choose for the hospital', () => pm.expect(b.canChoose.hospital).to.eql(true));",
    ],
  }),
  req('The receptionist may not (403)', 'GET', '/print-library', {
    token: 'xRecv',
    tests: [status(403)],
  }),
  req(
    'The SuperAdmin chooses the modern bill for the whole hospital',
    'PUT',
    '/print-library/templates/{{xTplBill2}}/choose?scope=hospital',
    {
      token: 'xSuper',
      body: {},
      tests: [
        status(200),
        "pm.test('hospital scope', () => pm.expect(pm.response.json().scope).to.eql('HOSPITAL'));",
      ],
    },
  ),
  req('It is marked in use', 'GET', '/print-library', {
    token: 'xSuper',
    tests: [
      status(200),
      "const t = pm.response.json().templates.find(x => x.id === pm.collectionVariables.get('xTplBill2'));",
      "pm.test('active', () => pm.expect(t.active).to.eql(true));",
    ],
  }),
  req(
    'A Branch Admin cannot choose for the whole hospital (403)',
    'PUT',
    '/print-library/templates/{{xTplBill}}/choose?scope=hospital',
    { token: 'xBranchAdmin', body: {}, tests: [status(403)] },
  ),
  req(
    'A Branch Admin chooses for the own branch',
    'PUT',
    '/print-library/templates/{{xTplBill}}/choose?scope=branch',
    {
      token: 'xBranchAdmin',
      body: {},
      tests: [
        status(200),
        "pm.test('branch scope', () => pm.expect(pm.response.json().scope).to.eql('BRANCH'));",
      ],
    },
  ),
  req(
    'A template that was not assigned is not found (404)',
    'PUT',
    '/print-library/templates/nope/choose',
    { token: 'xSuper', body: {}, tests: [status(404)] },
  ),
];

const terms = [
  req('The HQ Admin sets a word', 'PUT', '/indigo/hospitals/{{xNorthId}}/terminology', {
    token: 'xHqOwner',
    body: { items: { patients: 'Clients' } },
    tests: [status(200)],
  }),
  req('The hospital reads it', 'GET', '/terminology', {
    token: 'xRecv',
    tests: [
      status(200),
      "pm.test('the word', () => pm.expect(pm.response.json().items.patients).to.eql('Clients'));",
    ],
  }),
  req('Markup is refused', 'PUT', '/indigo/hospitals/{{xNorthId}}/terminology', {
    token: 'xHqOwner',
    body: { items: { patients: '<b>x</b>' } },
    tests: [status(400)],
  }),
  req('HQ Staff assigned to north clears it', 'PUT', '/indigo/hospitals/{{xNorthId}}/terminology', {
    token: 'xHqEmployee',
    body: { items: { patients: null } },
    tests: [status(200)],
  }),
  req('HQ Staff cannot touch south (403)', 'PUT', '/indigo/hospitals/{{xSouthId}}/terminology', {
    token: 'xHqEmployee',
    body: { items: { patients: 'X' } },
    tests: [status(403)],
  }),
  req('The hospital word is gone again', 'GET', '/terminology', {
    token: 'xRecv',
    tests: [
      status(200),
      "pm.test('empty', () => pm.expect(Object.keys(pm.response.json().items).length).to.eql(0));",
    ],
  }),
];

const setupConsole = [
  req(
    'The HQ Admin sets the main branch modules to what it already has',
    'PUT',
    '/indigo/hospitals/{{xNorthId}}/branches/{{xNorthBranchId}}/modules',
    { token: 'xHqOwner', raw: '{"moduleCodes":{{xNorthBranchModulesJson}}}', tests: [status(200)] },
  ),
  req(
    'OPD cannot be switched off for one branch',
    'PUT',
    '/indigo/hospitals/{{xNorthId}}/branches/{{xNorthBranchId}}/modules',
    { token: 'xHqOwner', body: { moduleCodes: [] }, tests: [status(400)] },
  ),
  req(
    'HQ Staff cannot switch branch modules (403)',
    'PUT',
    '/indigo/hospitals/{{xNorthId}}/branches/{{xNorthBranchId}}/modules',
    {
      token: 'xHqEmployee',
      raw: '{"moduleCodes":{{xNorthBranchModulesJson}}}',
      tests: [status(403)],
    },
  ),
  req(
    'The HQ Admin runs the starter masters (safe to press twice)',
    'POST',
    '/indigo/hospitals/{{xNorthId}}/starter',
    {
      token: 'xHqOwner',
      body: {},
      tests: [
        status(200),
        "pm.test('a report', () => pm.expect(pm.response.json().created).to.be.an('array'));",
      ],
    },
  ),
  req('HQ Staff cannot run it (403)', 'POST', '/indigo/hospitals/{{xNorthId}}/starter', {
    token: 'xHqEmployee',
    body: {},
    tests: [status(403)],
  }),
  req('The dashboard summary: SuperAdmin sees money and approvals', 'GET', '/dashboard/summary', {
    token: 'xSuper',
    tests: [
      status(200),
      'const s = pm.response.json().sections;',
      "pm.test('money and approvals', () => { pm.expect(s.money).to.eql(true); pm.expect(s.approvals).to.eql(true); });",
    ],
  }),
  req(
    'The dashboard summary: the receptionist has no approvals block',
    'GET',
    '/dashboard/summary',
    {
      token: 'xRecv',
      tests: [
        status(200),
        'const b = pm.response.json();',
        "pm.test('no approvals', () => { pm.expect(b.sections.approvals).to.eql(false); pm.expect(b.pendingApprovals).to.eql(null); });",
      ],
    },
  ),
];

const cleanup = [
  req('The assignment is taken away again', 'PUT', '/indigo/hospitals/{{xNorthId}}/library', {
    token: 'xHqOwner',
    body: { templateIds: [], logoIds: [] },
    tests: [status(200)],
  }),
];

const collection = {
  info: {
    name: 'Hospigo 2.1f: template library, terminology, branch modules, starter, dashboard',
    description:
      'Step 2.1f. Needs the Hospigo Local environment (baseUrl, staffPassword, superadminPassword, branchAdminPassword, indigoPassword) and the demo seed with the Indigo demo people (SEED_INDIGO_PASSWORD). Cleans up after itself (designs removed, assignment taken away, words cleared).',
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
    { name: '1 Library (HQ Admin)', item: library },
    { name: '2 The hospital chooses', item: chooser },
    { name: '3 Terminology', item: terms },
    { name: '4 Branch modules, starter, dashboard', item: setupConsole },
    { name: '5 Clean up', item: cleanup },
  ],
};
const out = path.resolve('postman/collections/hospigo-2-1f-library.postman_collection.json');
fs.writeFileSync(out, JSON.stringify(collection, null, 2) + '\n');
console.log('written', out);
