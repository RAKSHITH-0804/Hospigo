import { fireEvent, render, screen } from '@testing-library/react';
import { InputField } from './field';
import { PasswordInput } from './password-input';
import { staffCopy } from '@/config/staff-copy';

describe('PasswordInput', () => {
  it('hides the password by default and shows it when the eye button is pressed', () => {
    render(<PasswordInput aria-label="pw" defaultValue="secret" />);
    const input = screen.getByLabelText('pw') as HTMLInputElement;
    expect(input.type).toBe('password');
    const eye = screen.getByRole('button', { name: staffCopy.field.showPassword });
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(eye);
    expect(input.type).toBe('text');
    expect(input.value).toBe('secret');
    expect(
      screen
        .getByRole('button', { name: staffCopy.field.hidePassword })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: staffCopy.field.hidePassword }));
    expect(input.type).toBe('password');
  });

  it('the eye button never submits a form and is a normal tab stop', () => {
    const onSubmit = jest.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="pw" />
      </form>,
    );
    const eye = screen.getByRole('button', { name: staffCopy.field.showPassword });
    expect(eye.getAttribute('type')).toBe('button');
    expect(eye.getAttribute('tabindex')).toBeNull();
    fireEvent.click(eye);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('InputField with type password gets the same eye button', () => {
    render(<InputField label="New password" type="password" />);
    expect((screen.getByLabelText('New password') as HTMLInputElement).type).toBe('password');
    expect(screen.getByRole('button', { name: staffCopy.field.showPassword })).toBeTruthy();
  });
});
