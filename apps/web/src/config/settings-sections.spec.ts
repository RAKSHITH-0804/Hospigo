import { staffCopy } from '@/config/staff-copy';
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  groupSettingsSections,
  visibleSettingsSections,
} from './settings-sections';

describe('the settings menu', () => {
  it('every section belongs to a known group, and every group has its heading in the copy', () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(SETTINGS_GROUPS).toContain(section.group);
    }
    for (const group of SETTINGS_GROUPS) {
      expect(staffCopy.settings.groups[group]).toBeTruthy();
    }
  });

  it('lists the sections under Hospital, People, Patients and OPD, in that order', () => {
    const grouped = groupSettingsSections(SETTINGS_SECTIONS).map((g) => [
      g.group,
      g.sections.map((s) => s.id),
    ]);
    expect(grouped).toEqual([
      ['hospital', ['branding', 'printing']],
      ['people', ['staff', 'roles', 'doctors']],
      ['patients', ['patient-registration', 'patient-numbers']],
      ['opd', ['opd-rules', 'prices', 'upload-lists']],
    ]);
  });

  it('the Prices section is for people who may change prices only', () => {
    expect(visibleSettingsSections(['hospital.settings.read']).some((s) => s.id === 'prices')).toBe(
      false,
    );
    expect(
      visibleSettingsSections(['hospital.settings.read', 'opd.prices.write']).some(
        (s) => s.id === 'prices',
      ),
    ).toBe(true);
  });

  it('Upload lists is for people who may change the masters only', () => {
    const has = (permissions: string[]) =>
      visibleSettingsSections(permissions).some((s) => s.id === 'upload-lists');
    expect(has(['hospital.settings.read'])).toBe(false);
    expect(has(['hospital.settings.read', 'opd.masters.write'])).toBe(true);
  });

  it('leaves out a heading with nothing under it, and keeps every section once', () => {
    const only = visibleSettingsSections(['hospital.settings.read']);
    const grouped = groupSettingsSections(only);
    expect(grouped.map((g) => g.group)).toEqual(['hospital', 'patients', 'opd']); // People needs its own permissions
    expect(grouped.flatMap((g) => g.sections)).toHaveLength(only.length);
    expect(groupSettingsSections([])).toEqual([]);
  });

  it('a person with the people permissions sees the People heading with only what they may open', () => {
    const grouped = groupSettingsSections(
      visibleSettingsSections(['hospital.settings.read', 'user.read']),
    );
    expect(grouped.find((g) => g.group === 'people')!.sections.map((s) => s.id)).toEqual(['staff']);
  });
});
