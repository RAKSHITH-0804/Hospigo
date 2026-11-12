/**
 * @jest-environment node
 */
import { MODULE_NAV_BY_CODE, moduleCodeForAppPath, shellNavFromEnabledModules } from './modules';

describe('module nav mapping', () => {
  it('builds Dashboard plus mapped enabled modules only', () => {
    const items = shellNavFromEnabledModules([
      { code: 'OPD', name: 'Outpatient' },
      { code: 'UNKNOWN_X', name: 'Skip me' },
      { code: 'LAB', name: 'Laboratory' },
    ]);
    expect(items[0]).toEqual({ href: '/app', label: 'Dashboard' });
    expect(items.map((i) => i.href)).toEqual(['/app', '/app/opd', '/app/lab']);
    expect(items.find((i) => i.label === 'Skip me')).toBeUndefined();
  });

  it('dedupes modules that share a route (LAB + RADIOLOGY)', () => {
    const items = shellNavFromEnabledModules([
      { code: 'LAB', name: 'Lab' },
      { code: 'RADIOLOGY', name: 'Radiology' },
    ]);
    expect(items.filter((i) => i.href === '/app/lab')).toHaveLength(1);
  });

  it('resolves module codes from app paths', () => {
    expect(moduleCodeForAppPath('/app')).toBeNull();
    expect(moduleCodeForAppPath('/app/opd')).toBe('OPD');
    expect(moduleCodeForAppPath('/app/opd/token/1')).toBe('OPD');
    expect(MODULE_NAV_BY_CODE['PHARMACY']?.href).toBe('/app/pharmacy');
  });
});
