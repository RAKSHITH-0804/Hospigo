'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePicker } from '@/components/images/image-picker';
import { AvailabilityDialog } from '@/components/settings/availability-panel';
import { SettingBlock } from '@/components/settings/setting-block';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import {
  removeDoctorSignature,
  saveDoctorProfile,
  uploadDoctorSignature,
} from '@/lib/doctors/client';
import { pictureErrorMessage } from '@/lib/images/errors';
import type { DoctorProfile, DoctorsListResponse } from '@/lib/doctors/types';
import { errorMessageFor } from '@/lib/patients/client';
import { settingsErrorMessage } from '@/lib/settings/errors';

const copy = staffCopy.settings.doctors;
const pictures = staffCopy.pictures.signature;
const availability = staffCopy.availability;

type Draft = {
  printedName: string;
  qualifications: string;
  speciality: string;
  registrationNo: string;
  department: string;
};

const draftOf = (d: DoctorProfile): Draft => ({
  printedName: d.printedName ?? '',
  qualifications: d.qualifications ?? '',
  speciality: d.speciality ?? '',
  registrationNo: d.registrationNo ?? '',
  department: d.department ?? '',
});

/**
 * The Admin list of doctors with the details that print on a prescription. A Branch Admin gets only
 * the doctors of their own branch from the API. Every save goes through the API, which checks the
 * permission, the branch scope and every value.
 */
export function DoctorsList({
  initial,
  initialErrorCode,
}: {
  initial: DoctorsListResponse | null;
  initialErrorCode: string | null;
}) {
  const [items, setItems] = useState(initial?.items ?? []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [availabilityId, setAvailabilityId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (message?.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => setMessage(null), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [message]);

  if (!initial) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }
  const { limits, canWrite, images } = initial;

  function open(doctor: DoctorProfile) {
    if (editingId === doctor.id) {
      setEditingId(null);
      setDraft(null);
      return;
    }
    setEditingId(doctor.id);
    setDraft(draftOf(doctor));
    setMessage(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (busy.current || !draft) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setMessage(null);
    const result = await saveDoctorProfile(id, draft);
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setMessage({ kind: 'error', text: settingsErrorMessage(result) });
      return;
    }
    setItems((rows) => rows.map((r) => (r.id === id ? result.data : r)));
    setDraft(draftOf(result.data));
    setMessage({ kind: 'ok', text: copy.saved });
  }

  const availabilityDoctor = items.find((d) => d.id === availabilityId) ?? null;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const value = (text: string | null) => text ?? copy.notSet;

  return (
    <SettingBlock title={copy.title} description={copy.description}>
      {!canWrite ? <p className="type-label text-muted-foreground">{copy.readOnly}</p> : null}
      <p
        role={message?.kind === 'error' ? 'alert' : 'status'}
        className={`settings-flash settings-flash-lazy type-label ${message?.kind === 'error' ? 'text-destructive' : 'text-foreground'}`}
      >
        {message?.text ?? ''}
      </p>
      {items.length === 0 ? (
        <p className="type-label text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="settings-doctors">
          {items.map((doctor) => (
            <li key={doctor.id} className="settings-doctor">
              <div className="settings-doctor-head">
                <div className="settings-cell-name">
                  <span className="type-label-strong">{doctor.name}</span>
                  <span className="type-small text-muted-foreground">
                    {doctor.code}
                    {doctor.missing.length > 0 ? ` · ${copy.missingTag}` : ''}
                  </span>
                </div>
                <div className="cluster">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-haspopup="dialog"
                    aria-label={`${doctor.name}: ${availability.open}`}
                    onClick={() => setAvailabilityId(doctor.id)}
                  >
                    {availability.open}
                  </Button>
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`${doctor.name}: ${editingId === doctor.id ? copy.done : copy.edit}`}
                      onClick={() => open(doctor)}
                    >
                      {editingId === doctor.id ? copy.done : copy.edit}
                    </Button>
                  ) : null}
                </div>
              </div>
              <dl className="settings-doctor-details">
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnPrintedAs}</dt>
                  <dd className="type-label">{doctor.printName}</dd>
                </div>
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnDepartment}</dt>
                  <dd className="type-label">{value(doctor.department)}</dd>
                </div>
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnQualifications}</dt>
                  <dd className="type-label">{value(doctor.qualifications)}</dd>
                </div>
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnSpeciality}</dt>
                  <dd className="type-label">{value(doctor.speciality)}</dd>
                </div>
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnRegistration}</dt>
                  <dd className="type-label">{value(doctor.registrationNo)}</dd>
                </div>
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnSignature}</dt>
                  <dd className="type-label">
                    {doctor.signature ? copy.signatureAdded : copy.notSet}
                  </dd>
                </div>
                <div>
                  <dt className="type-small text-muted-foreground">{copy.columnWorksIn}</dt>
                  <dd className="type-label">{doctor.branches.join(', ') || copy.notSet}</dd>
                </div>
              </dl>
              {editingId === doctor.id && draft ? (
                <form
                  onSubmit={(event) => void onSubmit(event, doctor.id)}
                  noValidate
                  className="settings-panel"
                >
                  <fieldset disabled={saving} className="settings-part">
                    <div className="settings-field-medium">
                      <InputField
                        label={copy.printedName}
                        value={draft.printedName}
                        maxLength={limits.printedName}
                        autoComplete="off"
                        onChange={(event) => set({ printedName: event.target.value })}
                      />
                    </div>
                    <div className="settings-field-medium">
                      <InputField
                        label={copy.qualifications}
                        value={draft.qualifications}
                        maxLength={limits.qualifications}
                        autoComplete="off"
                        onChange={(event) => set({ qualifications: event.target.value })}
                      />
                    </div>
                    <div className="settings-field-medium">
                      <InputField
                        label={copy.speciality}
                        value={draft.speciality}
                        maxLength={limits.speciality}
                        autoComplete="off"
                        onChange={(event) => set({ speciality: event.target.value })}
                      />
                    </div>
                    <div className="settings-field-narrow">
                      <InputField
                        label={copy.registrationNo}
                        value={draft.registrationNo}
                        maxLength={limits.registrationNo}
                        autoComplete="off"
                        onChange={(event) => set({ registrationNo: event.target.value })}
                      />
                    </div>
                    <div className="settings-field-medium">
                      <InputField
                        label={copy.department}
                        value={draft.department}
                        maxLength={limits.department}
                        autoComplete="off"
                        onChange={(event) => set({ department: event.target.value })}
                      />
                    </div>
                  </fieldset>
                  <div className="settings-actions">
                    <Button type="submit" disabled={saving} className="touch-target">
                      {saving ? copy.saving : copy.save}
                    </Button>
                  </div>
                  <div className="flex flex-col gap-[var(--space-1)]">
                    <p className="type-label-strong">{pictures.title}</p>
                    <ImagePicker
                      image={doctor.signature}
                      limits={images}
                      canWrite
                      alt={`${doctor.name}: ${pictures.alt}`}
                      onUpload={async (file) => {
                        const result = await uploadDoctorSignature(doctor.id, file);
                        if (!result.ok) {
                          return pictureErrorMessage(result, images);
                        }
                        setItems((rows) => rows.map((r) => (r.id === doctor.id ? result.data : r)));
                        return null;
                      }}
                      onRemove={async () => {
                        const result = await removeDoctorSignature(doctor.id);
                        if (!result.ok) {
                          return pictureErrorMessage(result, images);
                        }
                        setItems((rows) => rows.map((r) => (r.id === doctor.id ? result.data : r)));
                        return null;
                      }}
                    />
                  </div>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {availabilityDoctor ? (
        <AvailabilityDialog
          doctorId={availabilityDoctor.id}
          doctorName={availabilityDoctor.name}
          onClose={() => setAvailabilityId(null)}
        />
      ) : null}
      <p className="type-small text-muted-foreground">{copy.note}</p>
    </SettingBlock>
  );
}
