'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/states/empty-state';
import { Eye } from 'lucide-react';
import { PrintSheet } from '@/components/print/print-sheet';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { staffCopy } from '@/config/staff-copy';
import { chooseLogo, chooseTemplate, type ChooserView } from '@/lib/indigo/library';
import { DOC_FIELD_ORDER, sampleItems } from '@/lib/print/form';
import type { PrintDocType, PrintTemplate } from '@/lib/print/types';
import { patientsApi } from '@/lib/patients/client';

const copy = staffCopy.library;
const DOC_TYPES = Object.keys(copy.docTypes);

/**
 * The designs Indigo assigned to this hospital: choose the one that prints for each document (a
 * SuperAdmin for the whole hospital, an Admin for the own branch) and the logo (SuperAdmin). The
 * API decides who may do what; the buttons shown follow what it says the person can do.
 */
export function PrintLibraryScreen({
  view,
  hospitalName = staffCopy.brand,
}: {
  view: ChooserView | null;
  hospitalName?: string;
}) {
  const [looking, setLooking] = useState<{ name: string; template: PrintTemplate } | null>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  if (!view) {
    return (
      <p role="alert" className="type-label text-destructive">
        {copy.loadFailed}
      </p>
    );
  }
  if (view.templates.length === 0 && view.logos.length === 0) {
    return <EmptyState title={copy.chooserTitle} description={copy.chooserEmpty} />;
  }
  const scope: 'branch' | 'hospital' = view.canChoose.hospital ? 'hospital' : 'branch';

  async function use(id: string) {
    setBusy(id);
    const result = await chooseTemplate(id, scope);
    setBusy(null);
    setNotice(result.ok ? { ok: true, text: copy.chosen } : { ok: false, text: copy.chooseFailed });
    if (result.ok) {
      router.refresh();
    }
  }
  async function look(id: string, name: string) {
    setBusy(id);
    const result = await patientsApi<PrintTemplate>(
      `/api/staff/print-library/templates/${encodeURIComponent(id)}`,
    );
    setBusy(null);
    if (result.ok) {
      setLooking({ name, template: result.data });
    } else {
      setNotice({ ok: false, text: copy.viewFailed });
    }
  }
  async function useLogo(id: string) {
    setBusy(id);
    const result = await chooseLogo(id);
    setBusy(null);
    setNotice(
      result.ok ? { ok: true, text: copy.logoChosen } : { ok: false, text: copy.chooseFailed },
    );
  }

  return (
    <div className="section-stack">
      <h1 className="type-heading font-medium">{copy.chooserTitle}</h1>
      <p className="type-label text-muted-foreground">{copy.chooserHint}</p>
      <p className="type-small">{scope === 'hospital' ? copy.forHospital : copy.forBranch}</p>
      {notice ? (
        <p role={notice.ok ? 'status' : 'alert'} className="type-small">
          {notice.text}
        </p>
      ) : null}
      <div className="settings-columns">
        {DOC_TYPES.map((docType) => {
          const mine = view.templates.filter((t) => t.docType === docType);
          if (mine.length === 0) {
            return null;
          }
          return (
            <section key={docType} className="consult-card flex flex-col gap-[var(--space-2)]">
              <h2 className="type-small font-medium">{copy.docTypes[docType]}</h2>
              <ul className="flex flex-col gap-[var(--space-2)]">
                {mine.map((t) => (
                  <li key={t.id} className="cluster-between type-small">
                    <span>
                      <span className="font-medium">{t.name}</span> · {t.paper}
                      {t.description ? ` · ${t.description}` : ''}
                    </span>
                    <span className="flex items-center gap-[var(--space-2)]">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void look(t.id, t.name)}
                      >
                        <Eye aria-hidden="true" className="mr-1" />
                        {copy.view}
                      </Button>
                      {t.active ? (
                        <span className="type-small font-medium">{copy.inUse}</span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy !== null || !view.canChoose[scope]}
                          onClick={() => void use(t.id)}
                        >
                          {copy.use}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {view.logos.length > 0 && view.canChoose.hospital ? (
          <section className="consult-card flex flex-col gap-[var(--space-2)]">
            <h2 className="type-small font-medium">{copy.logosHeading}</h2>
            <ul className="flex flex-col gap-[var(--space-2)]">
              {view.logos.map((l) => (
                <li key={l.id} className="cluster-between type-small">
                  <span className="flex items-center gap-[var(--space-2)]">
                    <img
                      src={`/api/staff/print-library/logos/${encodeURIComponent(l.id)}/image`}
                      alt={l.name}
                      className="library-logo"
                    />
                    {l.name}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void useLogo(l.id)}
                  >
                    {copy.logoUse}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {looking ? (
        <Modal
          title={copy.viewTitle.replace('{name}', looking.name)}
          onClose={() => setLooking(null)}
        >
          <p className="type-small text-muted-foreground">{copy.viewHint}</p>
          <div className="print-paper-wrap">
            <PrintSheet
              template={looking.template}
              items={sampleItems(
                [...DOC_FIELD_ORDER[looking.template.docType as PrintDocType]],
                hospitalName,
              )}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
