import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SettingsNav } from '@/components/settings/settings-nav';
import { SETTINGS_SECTIONS, visibleSettingsSections } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';

jest.mock('next/link', () => {
  return function Link({ href, children, ...props }: { href: string; children: ReactNode }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const groups = staffCopy.settings.groups;
const labels = staffCopy.settings.sections;
const all = visibleSettingsSections(SETTINGS_SECTIONS.map((s) => s.permission));
const heading = (name: string) => screen.getByRole('button', { name });
const link = (name: string) => screen.queryByRole('link', { name });

describe('the settings menu (groups that open and close)', () => {
  it('shows the four headings, and only the group of the current page is open', () => {
    render(<SettingsNav sections={all} activeId="staff" />);
    for (const name of Object.values(groups)) {
      expect(heading(name)).toBeTruthy();
    }
    expect(heading(groups.people).getAttribute('aria-expanded')).toBe('true');
    expect(heading(groups.hospital).getAttribute('aria-expanded')).toBe('false');
    // open: its sections are there; closed: not reachable at all
    expect(link(labels.staff)).toBeTruthy();
    expect(link(labels.roles)).toBeTruthy();
    expect(link(labels.doctors)).toBeTruthy();
    expect(link(labels.branding)).toBeNull();
    expect(link(labels.printing)).toBeNull();
    expect(link(labels.opdRules)).toBeNull();
  });

  it('pressing Hospital shows Logo and Printing and closes People', () => {
    render(<SettingsNav sections={all} activeId="staff" />);
    fireEvent.click(heading(groups.hospital));
    expect(link(labels.branding)).toBeTruthy();
    expect(link(labels.printing)).toBeTruthy();
    expect(link(labels.staff)).toBeNull();
    expect(heading(groups.hospital).getAttribute('aria-expanded')).toBe('true');
    expect(heading(groups.people).getAttribute('aria-expanded')).toBe('false');
  });

  it('pressing the open heading again closes it', () => {
    render(<SettingsNav sections={all} activeId="staff" />);
    fireEvent.click(heading(groups.people));
    expect(heading(groups.people).getAttribute('aria-expanded')).toBe('false');
    expect(link(labels.staff)).toBeNull();
  });

  it('the page you are on is marked, and its links go to the right place', () => {
    render(<SettingsNav sections={all} activeId="roles" />);
    expect(link(labels.roles)!.getAttribute('aria-current')).toBe('page');
    expect(link(labels.staff)!.getAttribute('aria-current')).toBeNull();
    expect(link(labels.roles)!.getAttribute('href')).toBe('/app/settings/roles');
  });

  it('with no current page the first group is open', () => {
    render(<SettingsNav sections={all} />);
    expect(heading(groups.hospital).getAttribute('aria-expanded')).toBe('true');
  });

  it('a person who may open fewer things sees only their headings and sections', () => {
    render(
      <SettingsNav
        sections={visibleSettingsSections(['hospital.settings.read'])}
        activeId="printing"
      />,
    );
    expect(screen.queryByRole('button', { name: groups.people })).toBeNull();
    fireEvent.click(heading(groups.patients));
    expect(link(labels.patientRegistration)).toBeTruthy();
    expect(link(labels.staff)).toBeNull();
  });

  it('the headings are real buttons wired to their lists', () => {
    render(<SettingsNav sections={all} activeId="staff" />);
    const button = heading(groups.people);
    const list = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(list.tagName).toBe('UL');
    expect(list.hidden).toBe(false);
  });
});
