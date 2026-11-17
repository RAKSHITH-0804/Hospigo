import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '@/components/ui/page-header';

jest.mock('next/link', () => {
  return function Link({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('back arrow', () => {
  it('is a small ghost icon button on the title line (no bordered box)', () => {
    render(<PageHeader title="Record" backHref="/app/patients" />);
    const back = screen.getByTestId('page-header-back');
    expect(back.className).toContain('page-header-back');
    expect(back.className).not.toMatch(/border|min-h|min-w/);
    expect(back.querySelector('svg')?.getAttribute('class')).toContain('--size-icon-menu');
    // Same row as the title, so it lines up with it.
    expect(back.parentElement?.contains(screen.getByRole('heading', { name: 'Record' }))).toBe(
      true,
    );
  });

  it('has a hit area from a token of at least 28px and no border in CSS', () => {
    const body = rule('.page-header-back');
    expect(body).toContain('width: var(--size-icon-button)');
    expect(body).toContain('height: var(--size-icon-button)');
    expect(body).not.toContain('border:');
    const token = /--size-icon-button:\s*([\d.]+)rem/.exec(css);
    expect(Number(token?.[1]) * 16).toBeGreaterThanOrEqual(28);
  });
});

describe('input font size', () => {
  it('is the 13px control size on desktop and 16px only on touch devices', () => {
    expect(css).toMatch(/--font-size-input:\s*var\(--font-size-body\);/);
    const touch = /@media \(pointer: coarse\)\s*{\s*:root\s*{\s*--font-size-input:\s*1rem;/.exec(
      css,
    );
    expect(touch).not.toBeNull();
    // No other place sets the input font to 1rem.
    expect(css.match(/--font-size-input:\s*1rem/g)).toHaveLength(1);
  });

  it('the patients search input uses the control tokens (32px class), not touch size', () => {
    expect(rule('.patients-search-field')).toContain('min-height: var(--size-input-height)');
    expect(rule('.patients-search-input')).toContain('font-size: var(--font-size-input)');
    expect(css).toContain('.patients-search-input::-webkit-search-cancel-button');
  });
});

describe('settings layout tokens', () => {
  it('uses tokens for the content max width and the narrow and medium inputs', () => {
    expect(css).toMatch(/--size-field-narrow:\s*12rem;/);
    expect(css).toMatch(/--size-field-medium:\s*24rem;/);
    expect(rule('.settings-content')).toContain('max-width: var(--size-settings-content-max)');
    expect(rule('.settings-field-narrow')).toContain('width: var(--size-field-narrow)');
    expect(rule('.settings-field-medium')).toContain('width: var(--size-field-medium)');
  });

  it('the section list is a vertical column on wide screens and a horizontal list on narrow ones', () => {
    expect(rule('.settings-layout')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toMatch(
      /@media \(width >= 43\.75rem\)\s*{\s*\.settings-layout\s*{\s*grid-template-columns: var\(--size-settings-nav\)/,
    );
    expect(rule('.settings-nav ul')).toContain('overflow-x: auto');
  });
});

describe('slip and register form polish', () => {
  it('the slip has its own inner padding token on screen and in print', () => {
    expect(css).toMatch(/--space-slip-padding:\s*[\d.]+rem;/);
    expect(rule('.patient-slip')).toContain('padding: var(--space-slip-padding)');
    const printBlock = css.slice(css.indexOf('@media print'));
    expect(printBlock).toContain('padding: var(--space-slip-padding)');
  });

  it('the selected Age / Date of birth mode is filled with the primary token', () => {
    const body = css.slice(css.indexOf(".patient-age-mode button[aria-pressed='true'] {"));
    expect(body.slice(0, body.indexOf('}'))).toMatch(
      /background: var\(--primary\);[\s\S]*color: var\(--primary-foreground\)/,
    );
  });
});
