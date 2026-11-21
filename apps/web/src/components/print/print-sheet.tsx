import type { CSSProperties } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { PrintButton } from '@/components/patients/print-button';
import {
  alignStyle,
  boxClasses,
  itemsByKey,
  pageRule,
  placeStyle,
  printsBox,
  runClasses,
  runStyle,
} from '@/lib/print/layout';
import { shownParagraphs, type ShownParagraph } from '@/lib/print/rich';
import { imageUrl } from '@/lib/images/types';
import type {
  PrintElement,
  PrintImages,
  PrintItem,
  PrintRun,
  PrintTemplate,
} from '@/lib/print/types';

/** The value of the document a field stands for: one line of text, a list of lines, or rows of two columns. */
function Value({ item }: { item: PrintItem }) {
  if ('text' in item) {
    return <>{item.text}</>;
  }
  if ('lines' in item) {
    return (
      <span className="print-block">
        {item.lines.map((line, index) => (
          <span key={`${index}-${line}`} className="print-line">
            {line}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="print-block">
      {item.pairs.map(([name, amount], index) => (
        <span key={`${index}-${name}`} className="print-pair">
          <span>{name}</span>
          <span className="print-pair-amount">{amount}</span>
        </span>
      ))}
    </span>
  );
}

/** One stretch of a paragraph: words, or the value of a field, each with its own style. */
function RunView({ run, byKey }: { run: PrintRun; byKey: ReadonlyMap<string, PrintItem> }) {
  const className = runClasses(run.style) || undefined;
  const style = runStyle(run.style);
  if (run.t === 'text') {
    return (
      <span className={className} style={style}>
        {run.text}
      </span>
    );
  }
  const item = byKey.get(run.field);
  if (!item) {
    return null;
  }
  return (
    <span className={className} style={style} data-value={run.field}>
      <Value item={item} />
    </span>
  );
}

/** A paragraph: its stretches one after the other, aligned as the paragraph says. */
export function ParagraphView({
  paragraph,
  byKey,
  separate,
}: {
  paragraph: ShownParagraph;
  byKey: ReadonlyMap<string, PrintItem>;
  /** Put a space between the stretches (pre-printed stationery prints values only). */
  separate?: boolean;
}) {
  return (
    <div className="print-para" style={alignStyle(paragraph.align)}>
      {paragraph.runs.length === 0 ? <span className="print-empty-line" /> : null}
      {paragraph.runs.map((run, index) => (
        <span key={index}>
          {separate && index > 0 ? ' ' : null}
          <RunView run={run} byKey={byKey} />
        </span>
      ))}
    </div>
  );
}

/**
 * What is INSIDE one box (the same drawing is used when printing and in the designer, so what you
 * see while designing is what prints). Text boxes show their paragraphs; with `valuesOnly` (pre-printed
 * stationery) only the values. A picture box is only a marker while there is no picture.
 */
export function BoxContent({
  element,
  byKey,
  valuesOnly,
  everything,
  placeholder,
  images,
}: {
  element: PrintElement;
  byKey: ReadonlyMap<string, PrintItem>;
  valuesOnly: boolean;
  /** The designer shows all of a text box, even a line whose values are empty. */
  everything?: boolean;
  /** The designer shows a marker for a picture box; printing shows the picture (or nothing). */
  placeholder?: string;
  /** The pictures of this page, by slot. */
  images?: PrintImages;
}) {
  if (element.type === 'LINE') {
    return <span className="print-rule" />;
  }
  if (element.type === 'IMAGE') {
    if (placeholder) {
      return <span className="print-image-marker">{placeholder}</span>;
    }
    const id = images?.[element.slot ?? 'LOGO'];
    return id ? <img className="print-image" src={imageUrl(id)} alt="" /> : null;
  }
  const paragraphs = everything
    ? (element.content?.paragraphs ?? [])
    : shownParagraphs(element.content, byKey, valuesOnly);
  return (
    <>
      {paragraphs.map((p, index) => (
        <ParagraphView
          key={index}
          paragraph={p}
          byKey={byKey}
          separate={valuesOnly && !everything}
        />
      ))}
    </>
  );
}

/**
 * One printed page made from a template (server component, no state): the boxes, each at its place.
 * Plain paper prints every box; pre-printed stationery prints only the VALUES inside text boxes, since
 * the letterhead and words are already on the paper. A line with values prints only when one of them
 * has something to say.
 */
export function PrintSheet({
  template,
  items,
  images,
  markEmptyPictures,
}: {
  template: PrintTemplate;
  items: PrintItem[];
  images?: PrintImages;
  /** The settings preview marks a picture box that has no picture (a printout leaves it empty). */
  markEmptyPictures?: { LOGO: string; SIGNATURE: string };
}) {
  const byKey = itemsByKey(items);
  const valuesOnly = template.mode === 'PREPRINTED';
  const sheetStyle: CSSProperties = {
    width: `${template.pageWidthMm}mm`,
    height: `${template.pageHeightMm}mm`,
    fontSize: `${template.layout.fontSizePt}pt`,
  };
  return (
    <div className="print-sheet" data-mode={template.mode} style={sheetStyle}>
      {template.layout.elements.map((element) => {
        if (!printsBox(template, element)) {
          return null;
        }
        if (
          element.type === 'RICH' &&
          shownParagraphs(element.content, byKey, valuesOnly).length === 0
        ) {
          return null;
        }
        return (
          <div
            key={element.id}
            className={boxClasses(element)}
            data-box={element.id}
            style={placeStyle(template, element)}
          >
            <BoxContent
              element={element}
              byKey={byKey}
              valuesOnly={valuesOnly}
              images={images}
              placeholder={
                element.type === 'IMAGE' && !images?.[element.slot ?? 'LOGO']
                  ? markEmptyPictures?.[element.slot ?? 'LOGO']
                  : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A whole print screen: the page rule of the template, a header with the Print button (hidden when
 * printing) and the sheet. The sheet is shown at its real size so what you see is what prints.
 */
export function PrintStage({
  template,
  items,
  images,
  title,
  description,
  backHref,
  printLabel,
}: {
  template: PrintTemplate;
  items: PrintItem[];
  images?: PrintImages;
  title: string;
  description?: string;
  backHref?: string;
  printLabel: string;
}) {
  return (
    <div className="print-stage flex flex-col gap-[var(--space-4)]">
      {/* @page cannot use CSS variables, so the size comes from the template itself. */}
      <style>{pageRule(template)}</style>
      <div className="no-print">
        <PageHeader
          title={title}
          description={description}
          backHref={backHref}
          actions={<PrintButton label={printLabel} />}
        />
      </div>
      <div className="print-paper-wrap">
        <PrintSheet template={template} items={items} images={images} />
      </div>
    </div>
  );
}
