import { PRINT_DOC_TYPES } from './print-template.rules';
import { sampleTemplates } from './sample-templates';

describe('sample templates (Step 2.1f)', () => {
  let all: ReturnType<typeof sampleTemplates> = [];
  try {
    all = sampleTemplates();
  } catch (e) {
    throw new Error(
      JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? String(e)),
    );
  }
  it('every sample passes the same checks as a saved template (none throws)', () => {
    expect(all.length).toBeGreaterThanOrEqual(PRINT_DOC_TYPES.length * 2);
  });
  it('every document type has two to three samples with distinct keys and names', () => {
    for (const docType of PRINT_DOC_TYPES) {
      const mine = all.filter((s) => s.docType === docType);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(mine.length).toBeLessThanOrEqual(3);
      expect(new Set(mine.map((s) => s.name)).size).toBe(mine.length);
    }
    expect(new Set(all.map((s) => s.key)).size).toBe(all.length);
  });
  it('no sample holds a hospital name or a typed address: those come from fields and values', () => {
    const text = JSON.stringify(all.map((s) => s.input));
    expect(text).not.toMatch(/Nandavana|Sagarika|Sukshema|Hospital Road/i);
    expect(text).toContain('value.address');
  });
});
