import type { Metadata } from 'next';
import { PrintStage } from '@/components/print/print-sheet';
import { EmptyState } from '@/components/states/empty-state';
import { staffCopy } from '@/config/staff-copy';
import { requirePermission } from '@/lib/auth/guards';
import { sampleItems, DOC_FIELD_ORDER } from '@/lib/print/form';
import { fetchLogoImageId, fetchTemplate, readTemplate } from '@/lib/print/server';
import { fill } from '@/lib/opd/clinical-format';

const copy = staffCopy.print.patientCard;

export const metadata: Metadata = { title: copy.testTitle };

/**
 * A test card on the label page, with obviously sample text, to check the printer, the label size and
 * the margins before real cards are printed. It never shows a real patient.
 */
export default async function CardTestPage() {
  const session = await requirePermission('hospital.settings.read');
  const hospitalName = session.hospitalName?.trim() || staffCopy.brand;
  const [templateResult, logoImageId] = await Promise.all([
    fetchTemplate('PATIENT_CARD'),
    fetchLogoImageId(),
  ]);
  const template = readTemplate(templateResult);
  if (!template) {
    return <EmptyState title={copy.notFoundTitle} description={copy.notFoundDescription} />;
  }
  return (
    <PrintStage
      template={template}
      items={sampleItems([...DOC_FIELD_ORDER.PATIENT_CARD], hospitalName)}
      images={{ LOGO: logoImageId }}
      title={copy.testTitle}
      description={`${copy.testDescription} ${fill(copy.sizeNote, {
        width: String(template.pageWidthMm),
        height: String(template.pageHeightMm),
      })}`}
      backHref="/app/settings/printing"
      printLabel={copy.print}
    />
  );
}
