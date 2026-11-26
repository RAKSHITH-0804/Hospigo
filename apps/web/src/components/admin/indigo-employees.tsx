'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import { createEmployee, saveEmployeeHospitals, setEmployeeActive } from '@/lib/indigo/client';
import type { IndigoEmployee } from '@/lib/indigo/types';

const copy = staffCopy.admin.console;

function EmployeeCard({
  employee,
  hospitals,
}: {
  employee: IndigoEmployee;
  hospitals: Array<{ id: string; name: string }>;
}) {
  const [ids, setIds] = useState<string[]>(employee.hospitalIds);
  const [active, setActive] = useState(employee.isActive);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    const result = await saveEmployeeHospitals(employee.id, ids);
    setBusy(false);
    setSaved(result.ok);
  }
  async function toggle() {
    setBusy(true);
    const result = await setEmployeeActive(employee.id, !active);
    setBusy(false);
    if (result.ok) {
      setActive(!active);
    }
  }

  return (
    <li className="consult-card flex flex-col gap-[var(--space-2)]">
      <p className="type-label font-medium">
        {employee.displayName} · {employee.email}
        {active ? '' : ` · ${copy.employeeInactive}`}
      </p>
      <p className="type-small font-medium">
        {fill(copy.employeeHospitals, { name: employee.displayName })}
      </p>
      <div className="flex flex-wrap gap-[var(--space-3)]">
        {hospitals.map((hospital) => (
          <label key={hospital.id} className="flex items-center gap-[var(--space-1)] type-small">
            <input
              type="checkbox"
              checked={ids.includes(hospital.id)}
              disabled={busy}
              onChange={(event) => {
                setSaved(false);
                setIds((current) =>
                  event.target.checked
                    ? [...current, hospital.id]
                    : current.filter((id) => id !== hospital.id),
                );
              }}
            />
            {hospital.name}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>
          {copy.employeeSaveHospitals}
        </Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void toggle()}>
          {active ? copy.employeeOff : copy.employeeOn}
        </Button>
        {saved ? (
          <p role="status" className="type-small">
            {copy.employeeSaved}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** The Indigo Owner adds Indigo employees and chooses which hospitals each one may enter. */
export function IndigoEmployees({
  employees,
  hospitals,
}: {
  employees: IndigoEmployee[];
  hospitals: Array<{ id: string; name: string }>;
}) {
  const [list, setList] = useState(employees);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setTemp(null);
    const result = await createEmployee({ name: name.trim(), email: email.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(copy.employeeFailed);
      return;
    }
    setTemp(
      fill(copy.employeeTemp, {
        email: result.data.email,
        password: result.data.temporaryPassword,
      }),
    );
    setList((current) => [
      ...current,
      {
        id: result.data.id,
        email: result.data.email,
        displayName: result.data.displayName,
        isActive: true,
        hospitalIds: [],
      },
    ]);
    setName('');
    setEmail('');
  }

  return (
    <div className="section-stack content-container-inner">
      <h1 className="type-heading font-medium">{copy.employeesTitle}</h1>
      <p className="type-label text-muted-foreground">{copy.employeesHint}</p>
      <form
        className="grid gap-[var(--space-3)] md:grid-cols-3"
        onSubmit={(event) => void add(event)}
        noValidate
      >
        <InputField
          label={copy.employeeName}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <InputField
          label={copy.employeeEmail}
          type="email"
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div className="flex items-end">
          <Button type="submit" className="touch-target" disabled={busy}>
            {busy ? copy.employeeCreating : copy.employeeCreate}
          </Button>
        </div>
      </form>
      {temp ? (
        <p role="status" className="type-label font-medium">
          {temp}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="type-label text-destructive">
          {error}
        </p>
      ) : null}
      {list.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.employeesEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--space-3)]">
          {list.map((employee) => (
            <EmployeeCard key={employee.id} employee={employee} hospitals={hospitals} />
          ))}
        </ul>
      )}
    </div>
  );
}
