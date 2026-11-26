'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { InputField, SelectField } from '@/components/ui/field';
import { staffCopy } from '@/config/staff-copy';
import { fill } from '@/lib/opd/clinical-format';
import {
  addSamples,
  createLibraryTemplate,
  getHospitalLibrary,
  LIBRARY_PRESETS,
  retireLibraryTemplate,
  saveHospitalLibrary,
  uploadLibraryLogo,
  type LibraryOverview,
} from '@/lib/indigo/library';

const copy = staffCopy.library;
const DOC_TYPES = Object.keys(copy.docTypes);

type Notice = { ok: boolean; text: string } | null;

function Message({ notice }: { notice: Notice }) {
  if (!notice) {
    return null;
  }
  return (
    <p role={notice.ok ? 'status' : 'alert'} className="type-small">
      {notice.text}
    </p>
  );
}

/** Assign the library to one hospital: which templates and logos it may choose from. */
function AssignPanel({
  overview,
  hospitals,
}: {
  overview: LibraryOverview;
  hospitals: Array<{ id: string; name: string }>;
}) {
  const [hospitalId, setHospitalId] = useState(hospitals[0]?.id ?? '');
  const [templates, setTemplates] = useState<string[]>([]);
  const [logos, setLogos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!hospitalId) {
      return undefined;
    }
    let stopped = false;
    setNotice(null);
    void getHospitalLibrary(hospitalId).then((result) => {
      if (!stopped && result.ok) {
        setTemplates(result.data.templateIds);
        setLogos(result.data.logoIds);
      }
    });
    return () => {
      stopped = true;
    };
  }, [hospitalId]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) =>
    set(on ? [...list, id] : list.filter((x) => x !== id));

  async function save() {
    setBusy(true);
    const result = await saveHospitalLibrary(hospitalId, {
      templateIds: templates,
      logoIds: logos,
    });
    setBusy(false);
    setNotice(
      result.ok ? { ok: true, text: copy.assignSaved } : { ok: false, text: copy.assignFailed },
    );
  }

  return (
    <section className="consult-card flex flex-col gap-[var(--space-3)]">
      <h2 className="type-small font-medium">{copy.assignHeading}</h2>
      <SelectField
        label={staffCopy.terms.chooseHospital}
        value={hospitalId}
        onChange={(event) => setHospitalId(event.target.value)}
      >
        {hospitals.map((h) => (
          <option key={h.id} value={h.id}>
            {h.name}
          </option>
        ))}
      </SelectField>
      <div className="settings-columns">
        {DOC_TYPES.map((docType) => {
          const mine = overview.templates.filter((t) => t.docType === docType && !t.retired);
          if (mine.length === 0) {
            return null;
          }
          return (
            <div key={docType} className="flex flex-col gap-[var(--space-1)]">
              <p className="type-small font-medium">{copy.docTypes[docType]}</p>
              {mine.map((t) => (
                <label key={t.id} className="flex items-center gap-[var(--space-1)] type-small">
                  <input
                    type="checkbox"
                    checked={templates.includes(t.id)}
                    disabled={busy}
                    onChange={(event) =>
                      toggle(templates, setTemplates, t.id, event.target.checked)
                    }
                  />
                  {t.name}
                </label>
              ))}
            </div>
          );
        })}
        <div className="flex flex-col gap-[var(--space-1)]">
          <p className="type-small font-medium">{copy.logosHeading}</p>
          {overview.logos.map((l) => (
            <label key={l.id} className="flex items-center gap-[var(--space-1)] type-small">
              <input
                type="checkbox"
                checked={logos.includes(l.id)}
                disabled={busy}
                onChange={(event) => toggle(logos, setLogos, l.id, event.target.checked)}
              />
              {l.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !hospitalId}
          onClick={() => void save()}
        >
          {copy.assignSave}
        </Button>
        <Message notice={notice} />
      </div>
    </section>
  );
}

/**
 * The Indigo Owner's template library: add the designed samples, make new templates, add logos and
 * decide which hospital may choose what. Only the Owner reaches this screen (the API refuses others).
 */
export function IndigoLibrary({
  overview,
  hospitals,
}: {
  overview: LibraryOverview;
  hospitals: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [docType, setDocType] = useState(DOC_TYPES[0]!);
  const [copyOf, setCopyOf] = useState('');
  const [preset, setPreset] = useState('');
  const [name, setName] = useState('');
  const [logoName, setLogoName] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const hasMissing = overview.samplesMissing > 0;
  const noTemplates = overview.templates.length === 0;
  const noLogos = overview.logos.length === 0;
  const hasHospitals = hospitals.length > 0;

  async function samples() {
    setBusy(true);
    const result = await addSamples();
    setBusy(false);
    if (result.ok) {
      setNotice({
        ok: true,
        text:
          result.data.added > 0
            ? fill(copy.samplesAdded, { count: result.data.added })
            : copy.samplesNone,
      });
      router.refresh();
    } else {
      setNotice({ ok: false, text: copy.createFailed });
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await createLibraryTemplate(
      copyOf ? { name, copyOf } : { name, docType, preset: preset || 'A5_FULL' },
    );
    setBusy(false);
    if (result.ok) {
      setNotice({ ok: true, text: copy.created });
      setName('');
      router.refresh();
    } else {
      setNotice({ ok: false, text: copy.createFailed });
    }
  }

  async function retire(id: string) {
    setBusy(true);
    const result = await retireLibraryTemplate(id);
    setBusy(false);
    setNotice(
      result.ok ? { ok: true, text: copy.retired } : { ok: false, text: copy.createFailed },
    );
    if (result.ok) {
      router.refresh();
    }
  }

  async function addLogo(event: FormEvent) {
    event.preventDefault();
    if (!logoFile) {
      return;
    }
    setBusy(true);
    const ok = await uploadLibraryLogo(logoName, logoFile);
    setBusy(false);
    setNotice(ok ? { ok: true, text: copy.logoAdded } : { ok: false, text: copy.logoFailed });
    if (ok) {
      setLogoName('');
      setLogoFile(null);
      router.refresh();
    }
  }

  return (
    <div className="section-stack content-container-inner">
      <div className="cluster-between">
        <h1 className="type-heading font-medium">{copy.consoleTitle}</h1>
        <Button type="button" disabled={busy} onClick={() => void samples()}>
          {busy ? copy.addingSamples : copy.addSamples}
        </Button>
      </div>
      <p className="type-label text-muted-foreground">{copy.consoleHint}</p>
      {hasMissing ? (
        <p className="type-small">
          {fill(copy.samplesMissing, { count: overview.samplesMissing })}
        </p>
      ) : null}
      <Message notice={notice} />

      <div className="settings-columns">
        <section className="consult-card flex flex-col gap-[var(--space-2)]">
          <h2 className="type-small font-medium">{copy.templatesHeading}</h2>
          {noTemplates ? (
            <p className="type-small text-muted-foreground">{copy.noTemplates}</p>
          ) : (
            DOC_TYPES.map((type) => {
              const mine = overview.templates.filter((t) => t.docType === type);
              return !mine.length ? null : (
                <div key={type} className="flex flex-col gap-[var(--space-1)]">
                  <p className="type-small font-medium">{copy.docTypes[type]}</p>
                  <ul className="flex flex-col gap-[var(--space-1)]">
                    {mine.map((t) => (
                      <li key={t.id} className="cluster-between type-small">
                        <span>
                          {t.name} · {t.paper}
                          {t.retired ? ` · ${copy.retiredTag}` : ''} ·{' '}
                          {fill(copy.assignedTo, { count: t.hospitalIds.length })}
                        </span>
                        {t.retired ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void retire(t.id)}
                          >
                            {copy.retire}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>

        <div className="flex flex-col gap-[var(--space-3)]">
          <form
            onSubmit={(event) => void create(event)}
            className="consult-card flex flex-col gap-[var(--space-2)]"
          >
            <h2 className="type-small font-medium">{copy.newTemplate}</h2>
            <p className="type-small text-muted-foreground">{copy.newTemplateHint}</p>
            <InputField
              label={copy.templateName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <SelectField
              label={copy.templateCopyOf}
              value={copyOf}
              onChange={(e) => setCopyOf(e.target.value)}
            >
              <option value="">{copy.presetNone}</option>
              {overview.templates
                .filter((t) => !t.retired)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {copy.docTypes[t.docType]} · {t.name}
                  </option>
                ))}
            </SelectField>
            {copyOf ? null : (
              <>
                <SelectField
                  label={copy.templateDocType}
                  value={docType}
                  onChange={(e) => setDocType(e.target.value)}
                >
                  {DOC_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {copy.docTypes[d]}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={copy.templatePreset}
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                >
                  <option value="">{copy.presetNone}</option>
                  {LIBRARY_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </SelectField>
              </>
            )}
            <Button type="submit" disabled={busy || name.trim() === ''}>
              {busy ? copy.creating : copy.createTemplate}
            </Button>
          </form>

          <section className="consult-card flex flex-col gap-[var(--space-2)]">
            <h2 className="type-small font-medium">{copy.logosHeading}</h2>
            {noLogos ? (
              <p className="type-small text-muted-foreground">{copy.noLogos}</p>
            ) : (
              <ul className="flex flex-wrap gap-[var(--space-3)]">
                {overview.logos.map((l) => (
                  <li key={l.id} className="flex items-center gap-[var(--space-2)] type-small">
                    <img
                      src={`/api/staff/indigo/library/logos/${encodeURIComponent(l.id)}/image`}
                      alt={l.name}
                      className="library-logo"
                    />
                    <span>
                      {l.name} · {fill(copy.assignedTo, { count: l.hospitalIds.length })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => void addLogo(event)}
              className="flex flex-col gap-[var(--space-2)]"
            >
              <InputField
                label={copy.logoName}
                value={logoName}
                onChange={(e) => setLogoName(e.target.value)}
                required
              />
              <label className="flex flex-col gap-[var(--space-1)] type-small">
                {copy.uploadLogo}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || !logoFile || logoName.trim() === ''}
              >
                {copy.logoAdd}
              </Button>
            </form>
          </section>
        </div>
      </div>

      {hasHospitals ? <AssignPanel overview={overview} hospitals={hospitals} /> : null}
    </div>
  );
}
