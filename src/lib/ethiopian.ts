/**
 * Ethiopian calendar (Amete Mihret) ↔ Gregorian.
 *
 * Julian Day Number based, so it is correct across leap years and Pagume
 * without any lookup tables. Never hardcode a date anywhere in this app.
 *
 * Epoch offset 1723856 = JDN of Meskerem 1, 1 A.M.
 */

export const ETH_EPOCH = 1723856;

export type EthiopianDate = { year: number; month: number; day: number };

/** Ge'ez month names. Index 0 = Meskerem, index 12 = Pagume (5–6 days). */
export const ETH_MONTHS_AM = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜን',
] as const;

export const ETH_MONTHS_EN = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miyazia', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
] as const;

/** Gregorian Y/M/D → Julian Day Number. */
export function gregorianToJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** JDN → Gregorian Y/M/D. */
export function jdnToGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/** Gregorian Date → Ethiopian date. */
export function toEthiopian(date: Date): EthiopianDate {
  const jdn = gregorianToJDN(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const offset = jdn - ETH_EPOCH;
  // r cycles within the 4-year (1461-day) leap cycle
  const r = ((offset % 1461) + 1461) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor(offset / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

/** Ethiopian date → Gregorian Date. */
export function toGregorian(e: EthiopianDate): Date {
  const jdn =
    ETH_EPOCH +
    365 * e.year +
    Math.floor(e.year / 4) +
    30 * (e.month - 1) +
    e.day -
    1;
  const g = jdnToGregorian(jdn);
  return new Date(g.year, g.month - 1, g.day);
}

/** True when the Ethiopian year has a 6-day Pagume. */
export function isEthiopianLeapYear(year: number): boolean {
  return year % 4 === 3;
}

/** e.g. "ሐምሌ ፬ ፣ ፳፻፲፰" or "Hamle 4, 2018" */
export function formatEthiopian(e: EthiopianDate, lang: 'am' | 'en'): string {
  if (lang === 'am') {
    return `${ETH_MONTHS_AM[e.month - 1]} ${toGeezNumeral(e.day)} ፣ ${toGeezNumeral(e.year)}`;
  }
  return `${ETH_MONTHS_EN[e.month - 1]} ${e.day}, ${e.year}`;
}

/**
 * BCP-47 tag for Intl/`toLocale*` formatting.
 *
 * Always pass this instead of `[]`: the device locale is not the app language,
 * so an Amharic reader on an English-configured phone would otherwise get
 * English dates and times inside an otherwise Amharic screen.
 */
export function localeTag(lang: 'am' | 'en'): string {
  return lang === 'am' ? 'am-ET' : 'en-US';
}

/**
 * Arabic numeral → Ge'ez numeral (፩ ፪ ፫ …).
 * Ge'ez has no zero and no positional notation: it composes from
 * units, tens, ፻ (100) and ፼ (10,000).
 */
const GEEZ_UNITS = ['', '፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱'];
const GEEZ_TENS = ['', '፲', '፳', '፴', '፵', '፶', '፷', '፸', '፹', '፺'];

export function toGeezNumeral(n: number): string {
  if (n <= 0) return String(n);
  if (n < 100) {
    return GEEZ_TENS[Math.floor(n / 10)] + GEEZ_UNITS[n % 10];
  }
  if (n < 10000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    const h = hundreds === 1 ? '፻' : toGeezNumeral(hundreds) + '፻';
    return h + (rest ? toGeezNumeral(rest) : '');
  }
  const tenThousands = Math.floor(n / 10000);
  const rest = n % 10000;
  const t = (tenThousands === 1 ? '' : toGeezNumeral(tenThousands)) + '፼';
  return t + (rest ? toGeezNumeral(rest) : '');
}
