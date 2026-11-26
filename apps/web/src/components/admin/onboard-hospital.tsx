'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { onboardHospital } from '@/lib/indigo/client';
import type { OnboardResult } from '@/lib/indigo/types';

const copy = staffCopy.admin.console;

type BranchDraft = { code: string; name: string; accessCode: string };

/** The form that creates a hospital (Indigo Owner only; the API refuses anyone else). */
export function OnboardHospital({
  moduleCatalog,
}: {
  moduleCatalog: Array<{ code: string; name: string }>;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [branches, setBranches] = useState<BranchDraft[]>([
    { code: 'MAIN', name: 'Main Branch', accessCode: '' },
  ]);
  const [mainIndex, setMainIndex] = useState(0);
  const [modules, setModules] = useState<string[]>(['OPD']);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OnboardResult | null>(null);

  const setBranch = (index: number, patch: Partial<BranchDraft>) =>
    setBranches((current) => current.map((b, i) => (i === index ? { ...b, ...patch } : b)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await onboardHospital({
      code: code.trim(),
      name: name.trim(),
      branches: branches.map((b, index) => ({ ...b, isMain: index === mainIndex })),
      moduleCodes: modules,
      superAdmin: { name: adminName.trim(), email: adminEmail.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.code === 'INDIGO_CONFLICT' ? copy.taken : copy.createFailed);
      return;
    }
    setDone(result.data);
  }

  if (done) {
    return (
      <div className="section-stack content-container-inner">
        <h1 className="type-heading font-medium">{copy.doneTitle}</h1>
        <p className="type-label">
          {done.hospital.name} ({done.hospital.code})
        </p>
        <ul className="type-label">
          {done.branches.map((branch) => (
            <li key={branch.code}>
              {fill(copy.branchLine, {
                name: branch.name,
                code: branch.code,
                accessCode: branch.accessCode,
              })}
            </li>
          ))}
        </ul>
        <p role="status" className="type-label font-medium">
          {fill(copy.doneTemp, { password: done.superAdmin.temporaryPassword })}
        </p>
        <p className="type-label">{fill(copy.doneNext, { command: done.nextStep })}</p>
      </div>
    );
  }

  return (
    <form
      className="section-stack content-container-inner"
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <h1 className="type-heading font-medium">{copy.onboardTitle}</h1>
      <p className="type-label text-muted-foreground">{copy.onboardHint}</p>
      <div className="grid gap-[var(--space-3)] md:grid-cols-2">
        <InputField
          label={copy.hospitalCode}
          value={code}
          disabled={busy}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <InputField
          label={copy.hospitalName}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-[var(--space-3)]">
        {branches.map((branch, index) => (
          <fieldset
            key={index}
            className="consult-card grid gap-[var(--space-3)] md:grid-cols-4"
            disabled={busy}
          >
            <InputField
              label={copy.branchCode}
              value={branch.code}
              onChange={(e) => setBranch(index, { code: e.target.value.toUpperCase() })}
            />
            <InputField
              label={copy.branchName}
              value={branch.name}
              onChange={(e) => setBranch(index, { name: e.target.value })}
            />
            <InputField
              label={copy.branchAccessCode}
              value={branch.accessCode}
              onChange={(e) => setBranch(index, { accessCode: e.target.value.toLowerCase() })}
            />
            <div className="flex flex-col gap-[var(--space-1)]">
              <label className="flex items-center gap-[var(--space-1)] type-label">
                <input
                  type="radio"
                  name="main-branch"
                  checked={mainIndex === index}
                  onChange={() => setMainIndex(index)}
                />
                {copy.branchMain}
              </label>
              {branches.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setBranches((current) => current.filter((_, i) => i !== index));
                    setMainIndex(0);
                  }}
                >
                  {copy.removeBranch}
                </Button>
              ) : null}
            </div>
          </fieldset>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setBranches((current) => [...current, { code: '', name: '', accessCode: '' }])
            }
          >
            {copy.addBranch}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-[var(--space-1)]">
        <p className="type-label font-medium">{copy.modulesHeading}</p>
        <div className="flex flex-wrap gap-[var(--space-3)]">
          {moduleCatalog.map((module) => (
            <label key={module.code} className="flex items-center gap-[var(--space-1)] type-label">
              <input
                type="checkbox"
                checked={modules.includes(module.code)}
                disabled={busy || module.code === 'OPD'}
                onChange={(event) =>
                  setModules((current) =>
                    event.target.checked
                      ? [...current, module.code]
                      : current.filter((c) => c !== module.code),
                  )
                }
              />
              {module.name}
              {module.code === 'OPD' ? ` (${copy.opdAlways})` : ''}
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-[var(--space-3)] md:grid-cols-2">
        <InputField
          label={copy.adminName}
          value={adminName}
          disabled={busy}
          onChange={(e) => setAdminName(e.target.value)}
        />
        <InputField
          label={copy.adminEmail}
          type="email"
          value={adminEmail}
          disabled={busy}
          onChange={(e) => setAdminEmail(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" className="touch-target" disabled={busy}>
          {busy ? copy.creating : copy.create}
        </Button>
      </div>
    </form>
  );
}
