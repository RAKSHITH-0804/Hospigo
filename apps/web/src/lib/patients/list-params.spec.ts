import {
  PatientListSort,
  PatientListSortColumn,
  directionForSort,
  isPatientListSort,
  sortPairForColumn,
  toggleSortForColumn,
} from '@/config/patients';
import { parseListParams } from './list-params';

const config = { searchMaxLength: 64, listSortDefault: PatientListSort.NEWEST };

describe('UHID sort mapping', () => {
  it('accepts the two new sort values', () => {
    expect(isPatientListSort('uhid_desc')).toBe(true);
    expect(isPatientListSort('uhid_asc')).toBe(true);
    expect(isPatientListSort('uhid_sideways')).toBe(false);
  });

  it('maps the UHID column to uhid_desc / uhid_asc and back', () => {
    expect(sortPairForColumn(PatientListSortColumn.UHID, 'desc')).toBe('uhid_desc');
    expect(sortPairForColumn(PatientListSortColumn.UHID, 'asc')).toBe('uhid_asc');
    expect(directionForSort(PatientListSortColumn.UHID, PatientListSort.UHID_DESC)).toBe('desc');
    expect(directionForSort(PatientListSortColumn.UHID, PatientListSort.NEWEST)).toBeNull();
  });

  it('first UHID click is highest first, then it reverses', () => {
    const first = toggleSortForColumn(
      PatientListSortColumn.UHID,
      PatientListSort.NEWEST,
      PatientListSortColumn.REGISTERED,
    );
    expect(first).toBe('uhid_desc');
    expect(toggleSortForColumn(PatientListSortColumn.UHID, first, PatientListSortColumn.UHID)).toBe(
      'uhid_asc',
    );
  });

  it('Registered on still uses newest / oldest', () => {
    expect(sortPairForColumn(PatientListSortColumn.REGISTERED, 'desc')).toBe('newest');
    expect(
      toggleSortForColumn(
        PatientListSortColumn.REGISTERED,
        PatientListSort.UHID_ASC,
        PatientListSortColumn.UHID,
      ),
    ).toBe('newest');
  });
});

describe('parseListParams', () => {
  it('keeps sort and col from the URL', () => {
    expect(parseListParams({ sort: 'uhid_asc', col: 'uhid' }, config)).toMatchObject({
      sort: 'uhid_asc',
      col: 'uhid',
    });
  });

  it('derives col from sort when col is missing or disagrees', () => {
    expect(parseListParams({ sort: 'uhid_desc' }, config).col).toBe('uhid');
    expect(parseListParams({ sort: 'uhid_desc', col: 'registered' }, config).col).toBe('uhid');
    expect(parseListParams({ sort: 'name_asc', col: 'uhid' }, config).col).toBe('name');
  });

  it('falls back to the default sort and the Registered column for unknown values', () => {
    expect(parseListParams({ sort: 'nope', col: 'nope' }, config)).toMatchObject({
      sort: 'newest',
      col: 'registered',
    });
  });
});
