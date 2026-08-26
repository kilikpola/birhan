import {
  toEthiopian,
  toGregorian,
  isEthiopianLeapYear,
  toGeezNumeral,
  formatEthiopian,
} from '../src/lib/ethiopian';

const eth = (y: number, m: number, d: number) => toEthiopian(new Date(y, m - 1, d));

describe('Ethiopian calendar', () => {
  it('converts a known date', () => {
    // 14 July 2026 → Hamle 7, 2018
    expect(eth(2026, 7, 14)).toEqual({ year: 2018, month: 11, day: 7 });
  });

  it('lands on Meskerem 1 at the new year', () => {
    expect(eth(2025, 9, 11)).toEqual({ year: 2018, month: 1, day: 1 });
    expect(eth(2026, 9, 11)).toEqual({ year: 2019, month: 1, day: 1 });
  });

  it('handles Pagume, the 13th month', () => {
    // The day before the new year is the last day of Pagume.
    const p = eth(2026, 9, 10);
    expect(p.month).toBe(13);
    expect(p.day).toBe(5);
  });

  it('gives Pagume 6 days in a leap year', () => {
    // EC 2015 is a leap year (2015 % 4 === 3), so its Pagume has 6 days
    // and the following new year slips to 12 September.
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect(isEthiopianLeapYear(2016)).toBe(false);
    expect(eth(2023, 9, 11)).toEqual({ year: 2015, month: 13, day: 6 });
    expect(eth(2023, 9, 12)).toEqual({ year: 2016, month: 1, day: 1 });
  });

  it('survives a Gregorian leap day', () => {
    expect(eth(2024, 2, 29)).toEqual({ year: 2016, month: 6, day: 21 });
  });

  it('round-trips', () => {
    for (let i = 0; i < 4000; i += 37) {
      const g = new Date(2020, 0, 1 + i);
      const back = toGregorian(toEthiopian(g));
      expect(back.toDateString()).toBe(g.toDateString());
    }
  });
});

describe('Ge’ez numerals', () => {
  it('composes correctly', () => {
    expect(toGeezNumeral(1)).toBe('፩');
    expect(toGeezNumeral(4)).toBe('፬');
    expect(toGeezNumeral(18)).toBe('፲፰');
    expect(toGeezNumeral(100)).toBe('፻');
    expect(toGeezNumeral(2018)).toBe('፳፻፲፰');
  });

  it('formats a full date', () => {
    const d = { year: 2018, month: 11, day: 7 };
    expect(formatEthiopian(d, 'am')).toBe('ሐምሌ ፯ ፣ ፳፻፲፰');
    expect(formatEthiopian(d, 'en')).toBe('Hamle 7, 2018');
  });
});
