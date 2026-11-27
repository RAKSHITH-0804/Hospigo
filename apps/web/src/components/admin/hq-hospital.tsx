'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  BranchModuleSwitches,
  ModuleSwitches,
  StarterButton,
} from '@/components/admin/indigo-hospitals';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { formatDateTime } from '@/lib/format-datetime';
import {
  activateDesign,
  createSuperAdmin,
  resetSuperAdmin,
  setHospitalLogo,
} from '@/lib/indigo/client';
import type { LibraryOverview } from '@/lib/indigo/library';
import type {
  HqActivePrint,
  HqCounts,
  HqSuperAdmin,
  IndigoHospitalRow,
  IndigoOverview,
} from '@/lib/indigo/types';
import { fill } from '@/lib/opd/clinical-format';

const copy = staffCopy.admin.hq;
const consoleCopy = staffCopy.admin.console;
const TABS = ['overview', 'branches', 'modules', 'print', 'terms', 'superAdmin'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: copy.tabOverview,
  branches: copy.tabBranches,
  modules: copy.tabModules,
  print: copy.tabPrint,
  terms: copy.tabTerms,
  superAdmin: copy.tabSuperAdmin,
};

function Overview({ counts }: { counts: HqCounts | null }) {
  if (!counts) {
    return <p className="type-small text-muted-foreground">{copy.countsHint}</p>;
  }
  const cells: Array<[string, string | number]> = [
    [copy.visitsToday, counts.visitsToday],
    [copy.visits7d, counts.visits7d],
    [copy.visits30d, counts.visits30d],
    [copy.activeUsers, counts.activeUsers30d],
    [
      copy.lastActivity,
      counts.lastActivity ? formatDateTime(counts.lastActivity) : copy.noActivity,
    ],
  ];
  return (
    <div className="flex flex-col gap-[var(--space-2)]">
      <div className="stat-grid">
        {cells.map(([label, value]) => (
          <div key={label} className="consult-card">
            <p className="type-small text-muted-foreground">{label}</p>
            <p className="type-label font-medium">{value}</p>
          </div>
        ))}
      </div>
      <p className="type-small text-muted-foreground">{copy.countsHint}</p>
    </div>
  );
}

function PrintTab({
  hospital,
  library,
  active,
  canPrint,
}: {
  hospital: IndigoHospitalRow;
  library: LibraryOverview | null;
  active: HqActivePrint | null;
  canPrint: boolean;
}) {
  const docTypes = Object.keys(staffCopy.library.docTypes);
  const labels = staffCopy.library.docTypes as Record<string, string>;
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      docTypes.map((d) => [
        d,
        active?.designs.find((x) => x.docType === d && x.branchId === null)?.libraryTemplateId ??
          '',
      ]),
    ),
  );
  const [logoId, setLogoId] = useState('');
  const [hasLogo, setHasLogo] = useState(active?.hasLogo ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!library || !active) {
    return <p className="type-small text-muted-foreground">{consoleCopy.ownerOnly}</p>;
  }

  async function apply(docType: string) {
    const templateId = choice[docType];
    if (!templateId) {
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await activateDesign(hospital.id, { templateId });
    setBusy(false);
    setNotice(
      result.ok
        ? { ok: true, text: copy.printApplied }
        : {
            ok: false,
            text: result.code === 'INDIGO_CONFLICT' ? copy.printNeedsAdmin : copy.superAdminFailed,
          },
    );
  }

  async function applyLogo() {
    if (!logoId) {
      return;
    }
    setBusy(true);
    setNotice(null);
    const result = await setHospitalLogo(hospital.id, logoId);
    setBusy(false);
    if (result.ok) {
      setHasLogo(true);
    }
    setNotice(
      result.ok
        ? { ok: true, text: copy.printApplied }
        : {
            ok: false,
            text: result.code === 'INDIGO_CONFLICT' ? copy.printNeedsAdmin : copy.superAdminFailed,
          },
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p className="type-small text-muted-foreground">{copy.printHint}</p>
      <div className="grid gap-[var(--space-3)] md:grid-cols-2">
        {docTypes.map((docType) => {
          const options = library.templates.filter((t) => t.docType === docType && !t.retired);
          return (
            <div key={docType} className="consult-card flex flex-col gap-[var(--space-2)]">
              <SelectField
                label={`${labels[docType] ?? docType} · ${copy.printWhole}`}
                value={choice[docType] ?? ''}
                disabled={busy || !canPrint || options.length === 0}
                onChange={(e) => setChoice((c) => ({ ...c, [docType]: e.target.value }))}
              >
                <option value="">{options.length === 0 ? copy.printNone : '-'}</option>
                {options.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectField>
              <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !canPrint || !choice[docType]}
                  onClick={() => void apply(docType)}
                >
                  {copy.printApply}
                </Button>
                {choice[docType] ? (
                  <Link href={`/admin/library/${choice[docType]}`} className="type-small underline">
                    {copy.designerLink}
                  </Link>
                ) : null}
              </div>
            </div>
          );
        })}
        <div className="consult-card flex flex-col gap-[var(--space-2)]">
          <SelectField
            label={copy.printLogo}
            value={logoId}
            disabled={busy || !canPrint || library.logos.length === 0}
            onChange={(e) => setLogoId(e.target.value)}
          >
            <option value="">{library.logos.length === 0 ? copy.printNone : '-'}</option>
            {library.logos.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
          <p className="type-small text-muted-foreground">
            {hasLogo ? copy.printHasLogo : copy.printNoLogo}
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !canPrint || !logoId}
              onClick={() => void applyLogo()}
            >
              {copy.printSetLogo}
            </Button>
          </div>
        </div>
      </div>
      {notice ? (
        <p role={notice.ok ? 'status' : 'alert'} className="type-small">
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}

function SuperAdminTab({
  hospital,
  admins,
  canReset,
}: {
  hospital: IndigoHospitalRow;
  admins: HqSuperAdmin[] | null;
  canReset: boolean;
}) {
  const [list] = useState(admins ?? []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function reset(user: HqSuperAdmin) {
    setBusy(true);
    setMessage(null);
    const result = await resetSuperAdmin(hospital.id, user.id);
    setBusy(false);
    setMessage(
      result.ok
        ? {
            ok: true,
            text: fill(copy.superAdminTemp, {
              email: user.email,
              password: result.data.temporaryPassword,
            }),
          }
        : { ok: false, text: copy.superAdminFailed },
    );
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await createSuperAdmin(hospital.id, { name: name.trim(), email: email.trim() });
    setBusy(false);
    setMessage(
      result.ok
        ? {
            ok: true,
            text: fill(copy.superAdminTemp, {
              email: result.data.email,
              password: result.data.temporaryPassword,
            }),
          }
        : { ok: false, text: copy.superAdminFailed },
    );
  }

  return (
    <div className="flex flex-col gap-[var(--space-3)]">
      <p className="type-small text-muted-foreground">{copy.superAdminHint}</p>
      {list.length === 0 ? (
        <>
          <p className="type-label">{copy.superAdminNone}</p>
          {canReset ? (
            <form
              className="grid gap-[var(--space-3)] md:grid-cols-3"
              onSubmit={(event) => void create(event)}
              noValidate
            >
              <InputField
                label={copy.superAdminName}
                value={name}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
              />
              <InputField
                label={copy.superAdminEmail}
                type="email"
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>
                  {copy.superAdminCreate}
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : (
        <ul className="flex flex-col gap-[var(--space-2)]">
          {list.map((user) => (
            <li
              key={user.id}
              className="consult-card flex flex-wrap items-center gap-[var(--space-3)]"
            >
              <div className="flex-1">
                <p className="type-label font-medium">
                  {user.displayName} · {user.email}
                </p>
                <p className="type-small text-muted-foreground">
                  {user.lastLoginAt
                    ? fill(copy.lastSignIn, { when: formatDateTime(user.lastLoginAt) })
                    : copy.neverSignedIn}
                </p>
              </div>
              {canReset ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void reset(user)}
                >
                  {copy.superAdminReset}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <p role={message.ok ? 'status' : 'alert'} className="type-label font-medium">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One page per hospital for HQ (Phase 2.2): counts, branches, modules, print design and logo,
 * terminology and the Super Admin. HQ never enters the hospital; every button talks to an HQ route
 * and the API checks the tick-box permission and the hospital assignment again.
 */
export function HqHospital({
  hospital,
  overview,
  counts,
  library,
  active,
  superAdmins,
}: {
  hospital: IndigoHospitalRow;
  overview: IndigoOverview;
  counts: HqCounts | null;
  library: LibraryOverview | null;
  active: HqActivePrint | null;
  superAdmins: HqSuperAdmin[] | null;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const can = (permission: string) => (overview.permissions ?? []).includes(permission);
  return (
    <div className="section-stack content-container-inner">
      <div className="cluster-between">
        <div>
          <Link href="/admin" className="type-small underline">
            {copy.back}
          </Link>
          <h1 className="type-heading font-medium">{hospital.name}</h1>
          <p className="type-small text-muted-foreground">
            {hospital.code} · {fill(consoleCopy.status, { status: hospital.status })}
          </p>
        </div>
      </div>
      <div role="tablist" className="flex flex-wrap gap-[var(--space-2)]">
        {TABS.map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </Button>
        ))}
      </div>
      {tab === 'overview' ? <Overview counts={counts} /> : null}
      {tab === 'branches' ? (
        <ul className="type-small">
          {hospital.branches.map((branch) => (
            <li key={branch.id}>
              {branch.accessCode
                ? fill(consoleCopy.branchLine, {
                    name: branch.name,
                    code: branch.code,
                    accessCode: branch.accessCode,
                  })
                : fill(consoleCopy.branchLineNoCode, { name: branch.name, code: branch.code })}
              {branch.isMain ? ` · ${consoleCopy.mainBranch}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {tab === 'modules' ? (
        can('hq.modules') ? (
          <div className="flex flex-col gap-[var(--space-3)]">
            <ModuleSwitches hospital={hospital} catalog={overview.moduleCatalog} />
            {hospital.branches.length > 1
              ? hospital.branches.map((branch) => (
                  <BranchModuleSwitches
                    key={branch.id}
                    hospital={hospital}
                    branch={branch}
                    catalog={overview.moduleCatalog}
                  />
                ))
              : null}
            {can('hq.onboard') ? <StarterButton hospitalId={hospital.id} /> : null}
          </div>
        ) : (
          <p className="type-small">{hospital.modules.join(', ')}</p>
        )
      ) : null}
      {tab === 'print' ? (
        <PrintTab
          hospital={hospital}
          library={library}
          active={active}
          canPrint={can('hq.print')}
        />
      ) : null}
      {tab === 'terms' ? (
        <Link href="/admin/terminology" className="type-label underline">
          {copy.tabTerms}
        </Link>
      ) : null}
      {tab === 'superAdmin' ? (
        <SuperAdminTab
          hospital={hospital}
          admins={superAdmins}
          canReset={can('hq.superadmin.reset')}
        />
      ) : null}
    </div>
  );
}
