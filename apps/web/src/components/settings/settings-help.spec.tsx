import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsHelp } from '@/components/settings/settings-help';
import { SettingsShell } from '@/components/settings/settings-shell';
import { SETTINGS_SECTIONS } from '@/config/settings-sections';
import { staffCopy } from '@/config/staff-copy';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const copy = staffCopy.settings.help;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('the help text', () => {
  it('every settings page has help: what it is, steps, an example and things to know', () => {
    for (const section of SETTINGS_SECTIONS) {
      const page = copy.pages[section.id];
      expect({ id: section.id, has: !!page }).toEqual({ id: section.id, has: true });
      expect(page!.what.length).toBeGreaterThan(20);
      expect(page!.steps.length).toBeGreaterThanOrEqual(2);
      expect(page!.example.length).toBeGreaterThan(20);
      expect(page!.good.length).toBeGreaterThanOrEqual(2);
      // short enough to read in about half a minute
      const words = [page!.what, ...page!.steps, page!.example, ...page!.good]
        .join(' ')
        .split(/\s+/);
      expect(words.length).toBeLessThan(220);
    }
  });

  it('only names buttons and labels that exist on the screens', () => {
    const p = staffCopy.settings;
    const fields = copy.pages['patient-registration']!.steps.join(' ');
    for (const word of [
      p.patientFields.columnShow,
      p.patientFields.columnRequired,
      p.patientFields.addButton,
    ]) {
      expect(fields).toContain(word);
    }
    const numbers = copy.pages['patient-numbers']!.steps.join(' ');
    for (const word of [
      p.uhidFormat.designHeading,
      p.uhidFormat.resetLabel,
      p.uhidFormat.previewLabel,
      p.uhidFormat.save,
      p.uhid.title,
    ]) {
      expect(numbers).toContain(word);
    }
    const printing = copy.pages.printing!.steps.join(' ');
    for (const word of [p.printing.modePreview, p.printing.insertValue]) {
      expect(printing).toContain(word);
    }
    expect(copy.pages.printing!.good.join(' ')).toContain(
      p.printing.reset.replace('Go back to the ', 'Go back to the '),
    );
  });
});

describe('SettingsHelp', () => {
  const region = () => screen.queryByRole('region', { name: copy.aboutTitle });
  const showButton = () => screen.getByRole('button', { name: new RegExp(copy.show) });

  it('is CLOSED when the page opens: only a Show help button is there', () => {
    render(<SettingsHelp pageId="patient-numbers" />);
    expect(region()).toBeNull();
    expect(showButton()).toBeTruthy();
    expect(screen.queryByText(copy.pages['patient-numbers']!.what, { exact: false })).toBeNull();
  });

  it('Show help opens all four parts, and Hide closes it again', () => {
    render(<SettingsHelp pageId="patient-numbers" />);
    fireEvent.click(showButton());
    const page = copy.pages['patient-numbers']!;
    const block = region()!;
    expect(block.textContent).toContain(page.what);
    expect(block.textContent).toContain(copy.how);
    for (const step of page.steps) expect(block.textContent).toContain(step);
    expect(block.textContent).toContain(page.example);
    for (const item of page.good) expect(block.textContent).toContain(item);
    expect(screen.getAllByRole('listitem')).toHaveLength(page.steps.length + page.good.length);
    fireEvent.click(screen.getByRole('button', { name: copy.hide }));
    expect(region()).toBeNull();
    expect(showButton()).toBeTruthy();
  });

  it('the steps are numbered and the points are bulleted', () => {
    render(<SettingsHelp pageId="opd-rules" />);
    fireEvent.click(showButton());
    expect(document.querySelector('ol.settings-help-steps')).toBeTruthy();
    expect(document.querySelector('ul.settings-help-points')).toBeTruthy();
  });

  it('every visit starts closed, and nothing is stored in the browser', () => {
    const first = render(<SettingsHelp pageId="opd-rules" />);
    fireEvent.click(showButton());
    expect(region()).toBeTruthy();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    first.unmount();
    render(<SettingsHelp pageId="opd-rules" />);
    expect(region()).toBeNull();
  });

  it('shows nothing for a page without help', () => {
    const { container } = render(<SettingsHelp pageId="unknown" />);
    expect(container.textContent).toBe('');
  });
});

describe('SettingsShell', () => {
  it('puts the Show help button above the content of every settings page', () => {
    for (const section of SETTINGS_SECTIONS) {
      const { unmount } = render(
        <SettingsShell sections={SETTINGS_SECTIONS} activeId={section.id}>
          <p>content</p>
        </SettingsShell>,
      );
      const button = screen.getByRole('button', { name: new RegExp(copy.show) });
      const content = screen.getByText('content');
      expect(
        button.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      fireEvent.click(button);
      expect(screen.getByRole('region', { name: copy.aboutTitle }).textContent).toContain(
        copy.pages[section.id]!.what,
      );
      unmount();
    }
  });

  it('shows no help on a page that is not a section (not found)', () => {
    render(
      <SettingsShell sections={SETTINGS_SECTIONS}>
        <p>content</p>
      </SettingsShell>,
    );
    expect(screen.queryByRole('button', { name: new RegExp(copy.show) })).toBeNull();
  });
});
