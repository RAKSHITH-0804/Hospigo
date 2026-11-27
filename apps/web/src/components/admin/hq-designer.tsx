'use client';

import { PrintingSettings } from '@/components/print/printing-settings';
import { staffCopy } from '@/config/staff-copy';
import { patientsApi } from '@/lib/patients/client';
import type {
  PrintDocType,
  PrintScope,
  PrintTemplate,
  PrintTemplateInput,
} from '@/lib/print/types';

const copy = staffCopy.admin.hq;

/**
 * The HQ designer (Phase 2.2): the same box editor the hospital's print screen uses, opened on one
 * library template with sample values. Save writes the library template; the API checks it like any
 * template. A hospital keeps its own copy until HQ sets the design again.
 */
export function HqDesigner({
  id,
  name,
  template,
}: {
  id: string;
  name: string;
  template: PrintTemplate;
}) {
  const save = (_docType: PrintDocType, input: PrintTemplateInput, _scope: PrintScope) =>
    patientsApi<PrintTemplate>(`/api/staff/indigo/library/templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: input,
    });
  return (
    <div className="section-stack">
      <h1 className="type-heading font-medium">{copy.designerTitle.replace('{name}', name)}</h1>
      <p className="type-label text-muted-foreground">{copy.designerHint}</p>
      <PrintingSettings
        templates={[template]}
        presets={[]}
        canWrite
        canChange={{ branch: false, hospital: true }}
        hospitalName={copy.designerSampleHospital}
        saveFn={save}
      />
    </div>
  );
}
