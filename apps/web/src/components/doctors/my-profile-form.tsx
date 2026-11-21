'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ImagePicker } from '@/components/images/image-picker';
import { SettingBlock } from '@/components/settings/setting-block';
import { SettingsHelp } from '@/components/settings/settings-help';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/field';
import { settingsScreenConfig } from '@/config/settings';
import { staffCopy } from '@/config/staff-copy';
import { errorMessageFor } from '@/lib/patients/client';
import { removeMySignature, saveMyProfile, uploadMySignature } from '@/lib/doctors/client';
import { pictureErrorMessage } from '@/lib/images/errors';
import type { MyProfileResponse } from '@/lib/doctors/types';
import { settingsErrorMessage } from '@/lib/settings/errors';

const copy = staffCopy.doctorProfile;
const pictures = staffCopy.pictures.signature;

/** The lines a prescription prints for this profile (the same wording as the print screens). */
export function previewLines(p: {
  printName: string;
  qualifications: string | null;
  speciality: string | null;
  registrationNo: string | null;
}): string[] {
  const fields = staffCopy.print.fields;
  return [
    p.printName,
    p.qualifications ?? '',
    p.speciality ?? '',
    p.registrationNo ? `${fields.doctorRegistrationNo}: ${p.registrationNo}` : '',
  ].filter(Boolean);
}

/**
 * "My profile": a doctor edits the details that print under their name. The profile is found by the
 * API from the signed-in user. The department is shown but only an Admin changes it.
 */
export function MyProfileForm({
  initial,
  initialErrorCode,
}: {
  initial: MyProfileResponse | null;
  initialErrorCode: string | null;
}) {
  const [profile, setProfile] = useState(initial);
  const [printedName, setPrintedName] = useState(initial?.printedName ?? '');
  const [qualifications, setQualifications] = useState(initial?.qualifications ?? '');
  const [speciality, setSpeciality] = useState(initial?.speciality ?? '');
  const [registrationNo, setRegistrationNo] = useState(initial?.registrationNo ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  // "Saved." fades away by itself; an error stays until the next action.
  useEffect(() => {
    if (!saved) {
      return;
    }
    const timer = setTimeout(() => setSaved(false), settingsScreenConfig.savedMessageMs);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!profile) {
    return (
      <SettingBlock title={copy.title} description={copy.description}>
        <p role="alert" className="type-label text-destructive">
          {initialErrorCode ? errorMessageFor(initialErrorCode) : copy.loadError}
        </p>
      </SettingBlock>
    );
  }
  const { limits } = profile;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    busy.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    const result = await saveMyProfile({ printedName, qualifications, speciality, registrationNo });
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setError(settingsErrorMessage(result));
      return;
    }
    setProfile(result.data);
    setPrintedName(result.data.printedName ?? '');
    setQualifications(result.data.qualifications ?? '');
    setSpeciality(result.data.speciality ?? '');
    setRegistrationNo(result.data.registrationNo ?? '');
    setSaved(true);
  }

  const lines = previewLines(profile);

  return (
    <div className="section-stack">
      <SettingsHelp pageId="doctor-profile" />
      <div className="settings-columns">
        <SettingBlock title={copy.detailsTitle} description="">
          {profile.missing.length > 0 ? (
            <div role="note" className="settings-reminder">
              <p className="type-label-strong">{copy.reminderTitle}</p>
              <p className="type-label">
                {copy.reminderBody.replace(
                  '{list}',
                  profile.missing.map((m) => copy.missingNames[m]).join(', '),
                )}
              </p>
            </div>
          ) : null}
          <dl className="settings-values">
            <div>
              <dt className="type-small text-muted-foreground">{copy.loginName}</dt>
              <dd className="type-body text-foreground">{profile.name}</dd>
            </div>
            <div>
              <dt className="type-small text-muted-foreground">
                {copy.department} ({copy.departmentHint})
              </dt>
              <dd className="type-body text-foreground">{profile.department ?? '—'}</dd>
            </div>
            <div>
              <dt className="type-small text-muted-foreground">{copy.worksIn}</dt>
              <dd className="type-body text-foreground">{profile.branches.join(', ') || '—'}</dd>
            </div>
          </dl>
          <form onSubmit={(event) => void onSubmit(event)} noValidate className="section-stack">
            <fieldset disabled={saving} className="section-stack">
              <InputField
                label={copy.printedName}
                hint={copy.printedNameHint}
                value={printedName}
                maxLength={limits.printedName}
                autoComplete="off"
                onChange={(event) => setPrintedName(event.target.value)}
              />
              <InputField
                label={copy.qualifications}
                hint={copy.qualificationsHint}
                value={qualifications}
                maxLength={limits.qualifications}
                autoComplete="off"
                onChange={(event) => setQualifications(event.target.value)}
              />
              <InputField
                label={copy.speciality}
                hint={copy.specialityHint}
                value={speciality}
                maxLength={limits.speciality}
                autoComplete="off"
                onChange={(event) => setSpeciality(event.target.value)}
              />
              <InputField
                label={copy.registrationNo}
                hint={copy.registrationNoHint}
                value={registrationNo}
                maxLength={limits.registrationNo}
                autoComplete="off"
                onChange={(event) => setRegistrationNo(event.target.value)}
              />
            </fieldset>
            <div className="settings-actions">
              <Button type="submit" disabled={saving} className="touch-target">
                {saving ? copy.saving : copy.save}
              </Button>
              <span role="status" className="settings-flash type-label text-foreground">
                {saved ? copy.saved : ''}
              </span>
            </div>
            {error ? (
              <p role="alert" className="type-label text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </SettingBlock>

        <div className="section-stack">
          <SettingBlock title={copy.previewLabel} description="">
            {lines.length > 1 || profile.printedName ? (
              <p className="settings-sample-block" data-testid="profile-preview">
                {lines.map((line) => (
                  <span key={line} className="type-body">
                    {line}
                  </span>
                ))}
              </p>
            ) : (
              <p className="type-label text-muted-foreground">{copy.previewEmpty}</p>
            )}
          </SettingBlock>
          <SettingBlock title={pictures.title} description={pictures.description}>
            <ImagePicker
              image={profile.signature}
              limits={profile.images}
              canWrite
              alt={pictures.alt}
              onUpload={async (file) => {
                const result = await uploadMySignature(file);
                if (!result.ok) {
                  return pictureErrorMessage(result, profile.images);
                }
                setProfile(result.data);
                return null;
              }}
              onRemove={async () => {
                const result = await removeMySignature();
                if (!result.ok) {
                  return pictureErrorMessage(result, profile.images);
                }
                setProfile(result.data);
                return null;
              }}
            />
            <p className="type-small text-muted-foreground">{pictures.note}</p>
          </SettingBlock>
        </div>
      </div>
    </div>
  );
}
