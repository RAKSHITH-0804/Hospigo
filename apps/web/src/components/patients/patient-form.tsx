'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { LoadingState } from '@/components/states/loading-state';
import { EmptyState } from '@/components/states/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { InputField, SelectField } from '@/components/ui/field';
import { DatePicker } from '@/components/ui/date-picker';
import { PageHeader } from '@/components/ui/page-header';
import { opdWebConfig } from '@/config/opd';
import { localTodayIso } from '@/lib/dates/calendar';
import {
  PATIENT_FORM_ELEMENT_ID,
  PATIENT_FORM_SECTION_ORDER,
  PATIENT_FORM_SECTION_RELATIVE,
  patientFormFieldSpan,
  PATIENT_AGE_DAYS_MAX,
  PATIENT_AGE_MONTHS_MAX,
  patientsWebConfig,
} from '@/config/patients';
import { sessionConfig } from '@/config/session';
import { staffCopy } from '@/config/staff-copy';
import {
  PATIENTS_API,
  PATIENTS_FORM_CONFIG_API,
  errorMessageFor,
  fieldErrorMessageFor,
  patientPath,
  patientsApi,
} from '@/lib/patients/client';
import { digitsOnly } from '@/lib/patients/format';
import {
  buildPatientBody,
  emptyValues,
  isEmptyBody,
  isSupportedCustomType,
  valuesFromDetail,
  type DobMode,
  type FormValues,
  type TextKey,
} from '@/lib/patients/payload';
import type {
  DuplicateMatch,
  FormConfigField,
  FormConfigResponse,
  PatientDetail,
} from '@/lib/patients/types';
import { cn } from '@/lib/utils';

const copy = staffCopy.patients;
const formCopy = copy.form;

type Phase = 'loading' | 'ready' | 'error' | 'notFound';

/** First-paint data fetched on the server by the page (no client fetch on load). */
export type PatientFormBoot = {
  fields?: FormConfigField[];
  detail?: PatientDetail;
  /** Server fetch failed: show not-found or the error code message. */
  failure?: 'notFound' | { code: string };
};

type Props = ({ mode: 'register'; patientId?: undefined } | { mode: 'edit'; patientId: string }) & {
  title: string;
  backHref: string;
  boot?: PatientFormBoot;
};

function bootState(boot: PatientFormBoot | undefined) {
  if (!boot) {
    return null;
  }
  if (boot.failure === 'notFound') {
    return { phase: 'notFound' as Phase };
  }
  if (boot.failure) {
    return { phase: 'error' as Phase, loadError: errorMessageFor(boot.failure.code) };
  }
  const fields = boot.fields ?? [];
  const values = boot.detail ? valuesFromDetail(boot.detail) : undefined;
  const relativeOpen = Boolean(
    values &&
    fields.some(
      (f) => f.section === PATIENT_FORM_SECTION_RELATIVE && f.code && values.custom[f.code],
    ),
  );
  return {
    phase: 'ready' as Phase,
    fields,
    uhid: boot.detail?.uhid ?? '',
    values,
    relativeOpen,
  };
}

function wrapCell(field: FormConfigField, node: ReactNode): ReactNode {
  if (!node) {
    return null;
  }
  const span = patientFormFieldSpan(field);
  const key = field.key ?? field.code ?? String(span);
  return (
    <div key={key} className="patient-form-cell" data-span={String(span)}>
      {node}
    </div>
  );
}

function recordHref(id: string): string {
  return `/app/patients/${encodeURIComponent(id)}`;
}

function sectionTitle(section: string): string {
  switch (section) {
    case 'PERSONAL':
      return formCopy.sectionPersonal;
    case 'CONTACT':
      return formCopy.sectionContact;
    case 'ADDRESS':
      return formCopy.sectionAddress;
    case 'RELATIVE':
      return formCopy.sectionRelative;
    case 'OTHER':
      return formCopy.sectionOther;
    default:
      return formCopy.sectionOther;
  }
}

function catalogToValueKey(catalogKey: string): TextKey | 'dateOfBirth' | 'ageYears' | null {
  switch (catalogKey) {
    case 'name':
      return 'name';
    case 'gender':
      return 'gender';
    case 'date_of_birth':
      return 'dateOfBirth';
    case 'phone':
      return 'phone';
    case 'email':
      return 'email';
    case 'address_street':
      return 'addressStreet';
    case 'address_cross':
      return 'addressCross';
    case 'address_area':
      return 'addressArea';
    case 'address_city':
      return 'addressCity';
    case 'address_state':
      return 'addressState';
    case 'address_pincode':
      return 'addressPincode';
    default:
      return null;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function PatientForm(props: Props) {
  const { mode, patientId, title, backHref, boot } = props;
  const router = useRouter();
  const [seed] = useState(() => bootState(boot));
  const [phase, setPhase] = useState<Phase>(seed?.phase ?? 'loading');
  const [loadError, setLoadError] = useState<string | null>(
    seed && 'loadError' in seed ? (seed.loadError ?? null) : null,
  );
  const [fields, setFields] = useState<FormConfigField[]>(
    seed && 'fields' in seed ? (seed.fields ?? []) : [],
  );
  const [uhid, setUhid] = useState(seed && 'uhid' in seed ? seed.uhid : '');
  const [initial, setInitial] = useState<FormValues | undefined>(
    seed && 'values' in seed ? seed.values : undefined,
  );
  const [values, setValues] = useState<FormValues>(
    seed && 'values' in seed && seed.values ? seed.values : emptyValues,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionPrompt, setSessionPrompt] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [relativeOpen, setRelativeOpen] = useState(
    seed && 'relativeOpen' in seed ? seed.relativeOpen : false,
  );
  const [summaryCount, setSummaryCount] = useState(0);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  const cfg = patientsWebConfig;

  const load = useCallback(async () => {
    setPhase('loading');
    setLoadError(null);
    const [config, detail] = await Promise.all([
      patientsApi<FormConfigResponse>(PATIENTS_FORM_CONFIG_API),
      mode === 'edit' && patientId
        ? patientsApi<PatientDetail>(patientPath(patientId))
        : Promise.resolve(null),
    ]);
    if (!config.ok) {
      setLoadError(errorMessageFor(config.code));
      setPhase('error');
      return;
    }
    if (detail && !detail.ok) {
      if (detail.status === 404) {
        setPhase('notFound');
      } else {
        setLoadError(errorMessageFor(detail.code));
        setPhase('error');
      }
      return;
    }
    setFields([...(config.data?.fields ?? [])]);
    if (detail?.ok) {
      const next = valuesFromDetail(detail.data);
      setUhid(detail.data.uhid);
      setInitial(next);
      setValues(next);
      const hasRelative = (config.data?.fields ?? []).some(
        (f) => f.section === PATIENT_FORM_SECTION_RELATIVE && f.code && next.custom[f.code],
      );
      if (hasRelative) {
        setRelativeOpen(true);
      }
    }
    setPhase('ready');
  }, [mode, patientId]);

  useEffect(() => {
    // Pages pass `boot` (fetched on the server). Without it the form loads on its own.
    if (!seed) {
      void load();
    }
  }, [load, seed]);

  const fieldsBySection = useMemo(() => {
    const map = new Map<string, FormConfigField[]>();
    for (const section of PATIENT_FORM_SECTION_ORDER) {
      map.set(section, []);
    }
    for (const field of fields) {
      const section = field.section && map.has(field.section) ? field.section : 'OTHER';
      map.get(section)!.push(field);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [fields]);

  function setText(key: TextKey, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  }

  function setCustom(code: string, value: string) {
    setValues((prev) => ({ ...prev, custom: { ...prev.custom, [code]: value } }));
    setErrors((prev) => ({ ...prev, [`custom:${code}`]: '' }));
  }

  function setDobMode(next: DobMode) {
    setValues((prev) => ({
      ...prev,
      dobMode: next,
      dateOfBirth: '',
      ageYears: '',
      ageMonths: '',
      ageDays: '',
    }));
    setErrors((prev) => ({ ...prev, dateOfBirth: '', ageYears: '' }));
  }

  function setRef(key: string, el: HTMLElement | null) {
    fieldRefs.current[key] = el;
  }

  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    for (const field of fields) {
      if (field.key === 'name') {
        if (!values.name.trim()) {
          next.name = formCopy.fieldErrorRequired;
        }
        continue;
      }
      if (field.key === 'date_of_birth') {
        const active = values.dobMode === 'dob' ? values.dateOfBirth : values.ageYears;
        const activeKey = values.dobMode === 'dob' ? 'dateOfBirth' : 'ageYears';
        if (!active.trim()) {
          if (field.required) {
            next[activeKey] = formCopy.fieldErrorRequired;
          }
        } else if (values.dobMode === 'age') {
          const age = Number(active);
          if (!Number.isInteger(age) || age < cfg.ageMin || age > cfg.ageMax) {
            next.ageYears = formCopy.fieldErrorInvalid;
          }
          const months = values.ageMonths.trim();
          const days = values.ageDays.trim();
          if (months && !(Number(months) >= 0 && Number(months) <= PATIENT_AGE_MONTHS_MAX)) {
            next.ageYears = formCopy.fieldErrorInvalid;
          }
          if (days && !(Number(days) >= 0 && Number(days) <= PATIENT_AGE_DAYS_MAX)) {
            next.ageYears = formCopy.fieldErrorInvalid;
          }
        }
        continue;
      }
      if (field.key === 'phone') {
        const phone = values.phone.trim();
        if (!phone) {
          if (field.required) {
            next.phone = formCopy.fieldErrorRequired;
          }
        } else if (phone.length !== cfg.phoneNationalLength) {
          next.phone = formCopy.fieldErrorInvalid;
        }
        continue;
      }
      if (field.key === 'email') {
        const email = values.email.trim();
        if (!email) {
          if (field.required) {
            next.email = formCopy.fieldErrorRequired;
          }
        } else if (!isValidEmail(email)) {
          next.email = formCopy.fieldErrorInvalid;
        }
        continue;
      }
      if (field.key === 'address_pincode') {
        const pin = values.addressPincode.trim();
        if (!pin) {
          if (field.required) {
            next.addressPincode = formCopy.fieldErrorRequired;
          }
        } else if (pin.length !== cfg.pincodeLength) {
          next.addressPincode = formCopy.fieldErrorInvalid;
        }
        continue;
      }
      if (field.key) {
        const valueKey = catalogToValueKey(field.key);
        if (valueKey && valueKey !== 'dateOfBirth' && valueKey !== 'ageYears') {
          if (field.required && !values[valueKey].trim()) {
            next[valueKey] = formCopy.fieldErrorRequired;
          }
        }
        continue;
      }
      if (field.code) {
        if (!isSupportedCustomType(field.dataType)) {
          continue;
        }
        const raw = (values.custom[field.code] ?? '').trim();
        if (!raw) {
          if (field.required) {
            next[`custom:${field.code}`] = formCopy.fieldErrorRequired;
          }
        } else if (field.dataType === 'NUMBER' && !Number.isFinite(Number(raw))) {
          next[`custom:${field.code}`] = formCopy.fieldErrorInvalid;
        }
      }
    }
    return next;
  }

  function focusFirstError(found: Record<string, string>) {
    const order: string[] = [];
    for (const section of PATIENT_FORM_SECTION_ORDER) {
      for (const field of fieldsBySection.get(section) ?? []) {
        if (field.key === 'date_of_birth') {
          order.push(values.dobMode === 'dob' ? 'dateOfBirth' : 'ageYears');
        } else if (field.key) {
          const vk = catalogToValueKey(field.key);
          if (vk) {
            order.push(vk);
          }
        } else if (field.code) {
          order.push(`custom:${field.code}`);
        }
      }
    }
    for (const key of order) {
      if (found[key]) {
        const el = fieldRefs.current[key];
        if (typeof el?.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        el?.focus();
        break;
      }
    }
  }

  function mapApiFieldErrors(apiErrors: Record<string, string>): Record<string, string> {
    const next: Record<string, string> = {};
    const unmapped: string[] = [];
    for (const [key, code] of Object.entries(apiErrors)) {
      const message = fieldErrorMessageFor(code);
      if (key === 'ageYears') {
        next.ageYears = message;
        if (values.dobMode === 'dob') {
          next.dateOfBirth = message;
        }
        continue;
      }
      if (key === 'date_of_birth') {
        if (values.dobMode === 'dob') {
          next.dateOfBirth = message;
        } else {
          next.ageYears = message;
        }
        continue;
      }
      if (key.startsWith('custom.')) {
        next[`custom:${key.slice('custom.'.length)}`] = message;
        continue;
      }
      const valueKey = catalogToValueKey(key);
      if (valueKey && valueKey !== 'dateOfBirth' && valueKey !== 'ageYears') {
        next[valueKey] = message;
        continue;
      }
      unmapped.push(key);
    }
    if (unmapped.length) {
      setFormError(formCopy.fieldErrorInvalid);
    }
    return next;
  }

  async function submit(confirmDuplicate: boolean) {
    if (submitting) {
      return;
    }
    const found = validate();
    setErrors(found);
    setFormError(null);
    setSessionPrompt(false);
    const count = Object.values(found).filter(Boolean).length;
    setSummaryCount(count);
    if (count > 0) {
      const relativeHasError = (fieldsBySection.get(PATIENT_FORM_SECTION_RELATIVE) ?? []).some(
        (f) => f.code && found[`custom:${f.code}`],
      );
      if (relativeHasError) {
        setRelativeOpen(true);
      }
      focusFirstInvalid(() => focusFirstError(found));
      return;
    }
    setSummaryCount(0);
    const visibleCustom = fields.filter((f) => f.code && isSupportedCustomType(f.dataType));
    const body = buildPatientBody(values, visibleCustom, mode === 'edit' ? initial : undefined);

    if (mode === 'edit' && patientId) {
      if (isEmptyBody(body)) {
        router.push(recordHref(patientId));
        return;
      }
      setSubmitting(true);
      const result = await patientsApi<{ id: string }>(patientPath(patientId), {
        method: 'PATCH',
        body,
      });
      setSubmitting(false);
      if (result.ok) {
        router.push(recordHref(result.data?.id ?? patientId));
        return;
      }
      if (result.status === 401) {
        setSessionPrompt(true);
        return;
      }
      if (result.status === 400 && result.fieldErrors) {
        const mapped = mapApiFieldErrors(result.fieldErrors);
        setErrors(mapped);
        setSummaryCount(Object.keys(mapped).length);
        focusFirstInvalid(() => focusFirstError(mapped));
        return;
      }
      setFormError(errorMessageFor(result.code));
      return;
    }

    setSubmitting(true);
    const result = await patientsApi<{ id: string; uhid: string }>(PATIENTS_API, {
      method: 'POST',
      body: confirmDuplicate ? { ...body, confirmDuplicate: true } : body,
    });
    setSubmitting(false);
    if (result.ok) {
      setDuplicates(null);
      router.push(recordHref(result.data.id));
      return;
    }
    if (result.status === 401) {
      setSessionPrompt(true);
      return;
    }
    if (result.status === 409 && result.code === 'POSSIBLE_DUPLICATE' && result.matches?.length) {
      setDuplicates(result.matches);
      return;
    }
    setDuplicates(null);
    if (result.status === 400 && result.fieldErrors) {
      const mapped = mapApiFieldErrors(result.fieldErrors);
      setErrors(mapped);
      setSummaryCount(Object.keys(mapped).length);
      const relativeHasError = (fieldsBySection.get(PATIENT_FORM_SECTION_RELATIVE) ?? []).some(
        (f) => f.code && mapped[`custom:${f.code}`],
      );
      if (relativeHasError) {
        setRelativeOpen(true);
      }
      focusFirstInvalid(() => focusFirstError(mapped));
      return;
    }
    setFormError(errorMessageFor(result.code));
  }

  function focusFirstInvalid(fn: () => void) {
    window.setTimeout(fn, 0);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(false);
  }

  const cancelHref = mode === 'edit' && patientId ? recordHref(patientId) : '/app/patients';

  const headerActions = (
    <>
      <Button type="submit" form={PATIENT_FORM_ELEMENT_ID} disabled={submitting}>
        {submitting
          ? formCopy.submitting
          : mode === 'edit'
            ? formCopy.submitSave
            : formCopy.submitRegister}
      </Button>
      <Link href={cancelHref} className={cn(buttonVariants({ variant: 'outline' }))}>
        {formCopy.cancel}
      </Link>
    </>
  );

  if (phase === 'loading') {
    return (
      <div className="flex flex-col gap-[var(--space-4)]">
        <PageHeader title={title} backHref={backHref} actions={headerActions} />
        <LoadingState label={copy.search.loading} />
      </div>
    );
  }
  if (phase === 'notFound') {
    return (
      <div className="flex flex-col gap-[var(--space-4)]">
        <PageHeader title={title} backHref={backHref} />
        <EmptyState
          title={copy.record.notFoundTitle}
          description={copy.record.notFoundDescription}
        />
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="flex flex-col gap-[var(--space-4)]">
        <PageHeader title={title} backHref={backHref} actions={headerActions} />
        <p role="alert" className="type-label text-destructive">
          {loadError ?? staffCopy.errors.tryAgain}
        </p>
      </div>
    );
  }

  const duplicateColumns: Array<DataTableColumn<DuplicateMatch>> = [
    {
      id: 'uhid',
      header: copy.duplicate.columnUhid,
      cell: (row) => <Link href={recordHref(row.id)}>{row.uhid}</Link>,
    },
    { id: 'name', header: copy.duplicate.columnName, cell: (row) => row.name },
  ];

  function renderBuiltin(field: FormConfigField): ReactNode {
    if (!field.key) {
      return null;
    }
    if (field.key === 'name') {
      return wrapCell(
        field,
        <InputField
          ref={(el) => setRef('name', el)}
          label={formCopy.name}
          required
          value={values.name}
          onChange={(e) => setText('name', e.target.value)}
          error={errors.name || undefined}
          autoComplete="off"
        />,
      );
    }
    if (field.key === 'gender') {
      return wrapCell(
        field,
        <SelectField
          ref={(el) => setRef('gender', el)}
          label={formCopy.gender}
          required={field.required}
          value={values.gender}
          onChange={(e) => setText('gender', e.target.value)}
          error={errors.gender || undefined}
        >
          <option value="">{formCopy.genderPlaceholder}</option>
          <option value={formCopy.genderMaleValue}>{formCopy.genderMale}</option>
          <option value={formCopy.genderFemaleValue}>{formCopy.genderFemale}</option>
          <option value={formCopy.genderOtherValue}>{formCopy.genderOther}</option>
        </SelectField>,
      );
    }
    if (field.key === 'date_of_birth') {
      const ageError = errors.ageYears || errors.dateOfBirth || undefined;
      const inputId = 'patient-age-or-dob';
      return wrapCell(
        field,
        <div className="patient-age-cell">
          <label htmlFor={inputId} className="type-label">
            {formCopy.dobOrAgeLabel}
            {field.required ? (
              <span className="text-destructive" aria-hidden="true">
                {' '}
                {staffCopy.field.requiredMark}
              </span>
            ) : null}
          </label>
          <div className="patient-age-control">
            <div className="patient-age-mode" role="group">
              <button
                type="button"
                aria-pressed={values.dobMode === 'dob'}
                onClick={() => setDobMode('dob')}
              >
                {formCopy.dobModeDob}
              </button>
              <button
                type="button"
                aria-pressed={values.dobMode === 'age'}
                onClick={() => setDobMode('age')}
              >
                {formCopy.dobModeAge}
              </button>
            </div>
            {values.dobMode === 'dob' ? (
              <DatePicker
                label={formCopy.dobPick}
                hideLabel
                jump
                value={values.dateOfBirth}
                max={localTodayIso()}
                weekStart={opdWebConfig.calendarWeekStart}
                quickDays={[]}
                onChange={(iso) => {
                  setValues((prev) => ({ ...prev, dateOfBirth: iso, ageYears: '' }));
                  setErrors((prev) => ({ ...prev, dateOfBirth: '', ageYears: '' }));
                }}
              />
            ) : (
              <div className="patient-age-parts">
                <input
                  id={inputId}
                  ref={(el) => setRef('ageYears', el)}
                  type="text"
                  inputMode="numeric"
                  aria-label={formCopy.ageYears}
                  placeholder={formCopy.ageUnitYears}
                  aria-required={field.required || undefined}
                  aria-invalid={ageError ? true : undefined}
                  value={values.ageYears}
                  maxLength={cfg.ageMaxDigits}
                  onChange={(e) => {
                    const next = digitsOnly(e.target.value, cfg.ageMaxDigits);
                    setValues((prev) => ({ ...prev, ageYears: next, dateOfBirth: '' }));
                    setErrors((prev) => ({ ...prev, ageYears: '', dateOfBirth: '' }));
                  }}
                  className={cn(
                    'field-control min-h-[var(--size-input-height)] h-[var(--size-input-height)] w-full rounded-e-[var(--radius-control)] border bg-card px-[var(--space-2)] text-[length:var(--font-size-input)] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    ageError ? 'border-destructive' : 'border-[var(--input-border)]',
                  )}
                />
              </div>
            )}
          </div>
          {ageError ? (
            <p role="alert" className="type-small text-destructive">
              {ageError}
            </p>
          ) : values.dobMode === 'age' ? (
            <p className="type-small text-muted-foreground">{formCopy.ageEstimatedNote}</p>
          ) : null}
        </div>,
      );
    }
    if (field.key === 'phone') {
      return wrapCell(
        field,
        <InputField
          ref={(el) => setRef('phone', el)}
          type="tel"
          inputMode="numeric"
          label={formCopy.phone}
          required={field.required}
          value={values.phone}
          maxLength={cfg.phoneNationalLength}
          narrow
          startAdornment={
            <span aria-label={formCopy.phonePrefixAria}>{cfg.phoneCountryCodePrefix}</span>
          }
          onChange={(e) => setText('phone', digitsOnly(e.target.value, cfg.phoneNationalLength))}
          error={errors.phone || undefined}
          autoComplete="off"
        />,
      );
    }
    if (field.key === 'email') {
      return wrapCell(
        field,
        <InputField
          ref={(el) => setRef('email', el)}
          type="email"
          label={formCopy.email}
          required={field.required}
          value={values.email}
          onChange={(e) => setText('email', e.target.value)}
          error={errors.email || undefined}
          autoComplete="off"
        />,
      );
    }
    const addressMap: Record<string, { key: TextKey; label: string }> = {
      address_street: { key: 'addressStreet', label: formCopy.addressStreet },
      address_cross: { key: 'addressCross', label: formCopy.addressCross },
      address_area: { key: 'addressArea', label: formCopy.addressArea },
      address_city: { key: 'addressCity', label: formCopy.addressCity },
      address_state: { key: 'addressState', label: formCopy.addressState },
      address_pincode: { key: 'addressPincode', label: formCopy.addressPincode },
    };
    const addr = addressMap[field.key];
    if (addr) {
      const isPin = field.key === 'address_pincode';
      return wrapCell(
        field,
        <InputField
          ref={(el) => setRef(addr.key, el)}
          label={addr.label}
          required={field.required}
          value={values[addr.key]}
          inputMode={isPin ? 'numeric' : undefined}
          maxLength={isPin ? cfg.pincodeLength : undefined}
          narrow={isPin}
          onChange={(e) =>
            setText(
              addr.key,
              isPin ? digitsOnly(e.target.value, cfg.pincodeLength) : e.target.value,
            )
          }
          error={errors[addr.key] || undefined}
          autoComplete="off"
        />,
      );
    }
    return null;
  }

  function renderCustom(field: FormConfigField): ReactNode {
    const code = field.code as string;
    const error = errors[`custom:${code}`] || undefined;
    if (!isSupportedCustomType(field.dataType)) {
      return wrapCell(
        field,
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-label-strong">{field.label}</p>
          <p className="type-small text-muted-foreground">{formCopy.unsupportedFieldType}</p>
        </div>,
      );
    }
    if (field.dataType === 'DROPDOWN') {
      const options = [...(field.options ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
      return wrapCell(
        field,
        <SelectField
          ref={(el) => setRef(`custom:${code}`, el)}
          label={field.label}
          required={field.required}
          value={values.custom[code] ?? ''}
          onChange={(e) => setCustom(code, e.target.value)}
          error={error}
        >
          <option value="">{formCopy.selectPlaceholder}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </SelectField>,
      );
    }
    const inputType =
      field.dataType === 'NUMBER' ? 'number' : field.dataType === 'DATE' ? 'date' : 'text';
    return wrapCell(
      field,
      <InputField
        ref={(el) => setRef(`custom:${code}`, el)}
        type={inputType}
        label={field.label}
        required={field.required}
        value={values.custom[code] ?? ''}
        onChange={(e) => setCustom(code, e.target.value)}
        error={error}
        narrow={field.dataType === 'NUMBER'}
        autoComplete="off"
      />,
    );
  }

  function renderSectionFields(section: string): ReactNode {
    const list = fieldsBySection.get(section) ?? [];
    if (!list.length) {
      return null;
    }
    return (
      <div className="patient-form-grid">
        {list.map((field) => (field.key ? renderBuiltin(field) : renderCustom(field)))}
      </div>
    );
  }

  const relativeFields = fieldsBySection.get(PATIENT_FORM_SECTION_RELATIVE) ?? [];
  const relativeHasValue = relativeFields.some(
    (f) => f.code && (values.custom[f.code] ?? '').trim(),
  );
  const relativeHasError = relativeFields.some((f) => f.code && errors[`custom:${f.code}`]);
  const showRelative = relativeOpen || relativeHasValue || relativeHasError;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <PageHeader title={title} backHref={backHref} actions={headerActions} />
      <Card>
        <CardContent>
          <form
            id={PATIENT_FORM_ELEMENT_ID}
            onSubmit={onSubmit}
            noValidate
            className="patient-form flex flex-col gap-[var(--space-form-section-gap)]"
            aria-busy={submitting || undefined}
          >
            {summaryCount ? (
              <p role="alert" className="type-label-strong text-destructive">
                {formCopy.validationSummary.replace('{count}', String(summaryCount))}
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="type-label-strong text-destructive">
                {formError}
              </p>
            ) : null}
            {sessionPrompt ? (
              <div
                role="alert"
                className="type-label flex flex-col gap-[var(--space-2)] text-destructive"
              >
                <p className="font-medium text-foreground">{formCopy.sessionExpiredTitle}</p>
                <p>{formCopy.sessionExpiredBody}</p>
                <a
                  href={sessionConfig.loginPath}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline"
                >
                  {formCopy.signInAgain}
                </a>
              </div>
            ) : null}

            {mode === 'edit' ? (
              <InputField label={formCopy.uhidReadOnly} value={uhid} readOnly narrow />
            ) : null}

            {PATIENT_FORM_SECTION_ORDER.filter((s) => s !== PATIENT_FORM_SECTION_RELATIVE).map(
              (section) => {
                const list = fieldsBySection.get(section) ?? [];
                if (!list.length) {
                  return null;
                }
                return (
                  <section
                    key={section}
                    aria-labelledby={`patient-section-${section}`}
                    className="patient-form-section"
                  >
                    <h2 id={`patient-section-${section}`} className="patient-form-section-title">
                      {sectionTitle(section)}
                    </h2>
                    {renderSectionFields(section)}
                  </section>
                );
              },
            )}

            {relativeFields.length ? (
              <section aria-labelledby="patient-section-RELATIVE" className="patient-form-section">
                <Button
                  type="button"
                  variant="ghost"
                  id="patient-section-RELATIVE"
                  aria-expanded={showRelative}
                  onClick={() => setRelativeOpen((open) => !open)}
                  className="justify-start gap-[var(--space-1)] px-0"
                >
                  {showRelative ? (
                    <ChevronDown aria-hidden="true" className="size-[var(--size-icon-menu)]" />
                  ) : (
                    <ChevronRight aria-hidden="true" className="size-[var(--size-icon-menu)]" />
                  )}
                  {showRelative ? formCopy.relativeToggleHide : formCopy.relativeToggleShow}
                </Button>
                {showRelative ? renderSectionFields(PATIENT_FORM_SECTION_RELATIVE) : null}
              </section>
            ) : null}

            {duplicates ? (
              <section
                aria-labelledby="patient-duplicate-title"
                className="flex flex-col gap-[var(--space-2)] rounded-[var(--radius-control)] border border-border bg-accent p-[var(--space-3)]"
              >
                <div>
                  <p id="patient-duplicate-title" className="type-label-strong">
                    {copy.duplicate.title}
                  </p>
                  <p className="type-label">{copy.duplicate.description}</p>
                </div>
                <DataTable
                  columns={duplicateColumns}
                  rows={duplicates}
                  ariaLabel={copy.duplicate.title}
                />
                <div className="flex flex-wrap gap-[var(--space-2)]">
                  <Button type="button" disabled={submitting} onClick={() => void submit(true)}>
                    {copy.duplicate.registerAnyway}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setDuplicates(null)}>
                    {copy.duplicate.cancel}
                  </Button>
                </div>
              </section>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
