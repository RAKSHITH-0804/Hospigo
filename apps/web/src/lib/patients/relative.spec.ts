import { relativeLine } from './relative';
import type { CustomFieldValue, FormConfigField } from './types';

const field = (code: string, section: string, sortOrder: number): FormConfigField => ({
  code,
  label: code,
  dataType: 'TEXT',
  required: false,
  sortOrder,
  section,
});

const fields: FormConfigField[] = [
  field('relative_name', 'RELATIVE', 102),
  field('relation_type', 'RELATIVE', 101),
  field('referred_by', 'OTHER', 103),
];

const values: CustomFieldValue[] = [
  { code: 'relative_name', valueText: ' Ravi Kumar ' },
  { code: 'relation_type', optionLabel: 'S/O' },
  { code: 'referred_by', valueText: 'Dr Rao' },
];

describe('relativeLine', () => {
  it('joins the RELATIVE-section values in the hospital sort order with a space', () => {
    expect(relativeLine(values, fields)).toBe('S/O Ravi Kumar');
  });

  it('ignores fields of other sections and fields without a value', () => {
    expect(relativeLine([{ code: 'referred_by', valueText: 'Dr Rao' }], fields)).toBe('');
    expect(relativeLine([{ code: 'relation_type', optionLabel: 'W/O' }], fields)).toBe('W/O');
    expect(relativeLine([{ code: 'relative_name', valueText: '   ' }], fields)).toBe('');
  });

  it('follows the hospital order, not the code names (nothing is named in code)', () => {
    const swapped = [field('relative_name', 'RELATIVE', 1), field('relation_type', 'RELATIVE', 2)];
    expect(relativeLine(values, swapped)).toBe('Ravi Kumar S/O');
    const renamed = [field('x1', 'RELATIVE', 1), field('x2', 'RELATIVE', 2)];
    expect(
      relativeLine(
        [
          { code: 'x1', optionLabel: 'D/O' },
          { code: 'x2', valueText: 'Meena' },
        ],
        renamed,
      ),
    ).toBe('D/O Meena');
  });

  it('is empty without custom values or without a form config', () => {
    expect(relativeLine(undefined, fields)).toBe('');
    expect(relativeLine(values, [])).toBe('');
  });
});
