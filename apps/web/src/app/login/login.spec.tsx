import { fireEvent, render, screen } from '@testing-library/react';
import LoginPage from './page';

describe('login concept screen', () => {
  it('renders one sample badge, brand copy, and empty hospital staff fields', () => {
    render(<LoginPage />);
    expect(screen.getAllByText('Sample data')).toHaveLength(1);
    expect(screen.getByText('One platform. Every hospital.')).toBeTruthy();
    expect(screen.getByText('A product by Indigo')).toBeTruthy();
    expect(screen.getByLabelText('Access code')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Email')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Password')).toHaveProperty('value', '');
    expect(screen.getByText(/login arrives in Step 6/i)).toBeTruthy();
    expect(document.body.textContent?.toLowerCase().includes(['mi', 'nio'].join(''))).toBe(false);
  });

  it('switches to Indigo HQ and hides the access code field', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Indigo HQ' }));
    expect(screen.queryByLabelText('Access code')).toBeNull();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});
