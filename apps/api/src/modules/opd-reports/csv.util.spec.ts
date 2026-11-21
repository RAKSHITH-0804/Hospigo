import { csvCell, csvRow, paiseToRupees } from './csv.util';

describe('csv helpers', () => {
  it('text that could run as a formula gets an apostrophe in front', () => {
    for (const text of [
      '=SUM(1+1)',
      '+1+1',
      '-1+2',
      '@cmd',
      '\tx',
      '\rx',
      '=HYPERLINK("http://x")',
    ]) {
      const cell = csvCell(text);
      expect({ text, safe: cell.replace(/^"/, '').startsWith("'") }).toEqual({ text, safe: true });
    }
  });

  it('a real number, even a negative one, stays a number', () => {
    expect(csvCell('-200.00')).toBe('-200.00');
    expect(csvCell('1234.50')).toBe('1234.50');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0)).toBe('0');
    // but anything that only looks a bit like a number is still text
    expect(csvCell('-5+2')).toBe("'-5+2");
    expect(csvCell('-')).toBe("'-");
    expect(csvCell('--5')).toBe("'--5");
    expect(csvCell('-5e3')).toBe("'-5e3");
    expect(csvCell('+5')).toBe("'+5");
  });

  it('quotes a cell with a comma, quote or line break and doubles the quotes', () => {
    expect(csvCell('Doctor, "Three"')).toBe('"Doctor, ""Three"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    // a formula with a comma is escaped AND quoted
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });

  it('writes a row', () => {
    expect(csvRow(['2026-11-20', 'MAIN', 'a,b', 5, null, '-1.00'])).toBe(
      '2026-11-20,MAIN,"a,b",5,,-1.00',
    );
  });

  it('whole paise as rupees with two decimals, by integer arithmetic only', () => {
    expect(paiseToRupees(0)).toBe('0.00');
    expect(paiseToRupees(5)).toBe('0.05');
    expect(paiseToRupees(100)).toBe('1.00');
    expect(paiseToRupees(12345)).toBe('123.45');
    expect(paiseToRupees(-20000)).toBe('-200.00');
    expect(paiseToRupees(-5)).toBe('-0.05');
    expect(paiseToRupees(2_147_483_647)).toBe('21474836.47');
    for (const bad of [1.5, Number.NaN, Infinity, 2 ** 53]) {
      expect(() => paiseToRupees(bad)).toThrow();
    }
  });
});
