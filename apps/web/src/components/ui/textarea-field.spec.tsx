import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TextareaField } from '@/components/ui/field';

let scrollHeight = 40;

beforeEach(() => {
  scrollHeight = 40;
  jest
    .spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(() => scrollHeight);
});
afterEach(() => {
  jest.restoreAllMocks();
});

function Box() {
  const [value, setValue] = useState('');
  return (
    <TextareaField label="Complaints" value={value} onChange={(e) => setValue(e.target.value)} />
  );
}

describe('TextareaField (grows with the text)', () => {
  it('starts as one small line and takes the height of its text as it grows', () => {
    render(<Box />);
    const box = screen.getByLabelText('Complaints') as HTMLTextAreaElement;
    expect(box.rows).toBe(1);
    expect(box.className).toContain('textarea-grow');
    expect(box.style.height).toBe('40px');
    scrollHeight = 130;
    fireEvent.change(box, { target: { value: 'a long note\nwith several\nlines of text' } });
    expect(box.style.height).toBe('130px');
  });

  it('shrinks again when the text is deleted', () => {
    render(<Box />);
    const box = screen.getByLabelText('Complaints') as HTMLTextAreaElement;
    scrollHeight = 200;
    fireEvent.change(box, { target: { value: 'x'.repeat(500) } });
    expect(box.style.height).toBe('200px');
    scrollHeight = 40;
    fireEvent.change(box, { target: { value: '' } });
    expect(box.style.height).toBe('40px');
  });

  it('still hands its element to a ref', () => {
    let seen: HTMLTextAreaElement | null = null;
    render(
      <TextareaField
        label="Advice"
        value=""
        onChange={() => undefined}
        ref={(node) => {
          seen = node;
        }}
      />,
    );
    expect(seen).toBe(screen.getByLabelText('Advice'));
  });
});
