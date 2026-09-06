import { t, type Lang } from '../i18n';

/**
 * "3d ago" from an ISO timestamp — the kind of relative time a person reads
 * without doing arithmetic. Falls back to a plain date past a year, and to the
 * raw date string if it will not parse.
 */
export function timeAgo(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);

  const secs = Math.max(0, (Date.now() - then) / 1000);
  const mins = secs / 60;
  const hours = mins / 60;
  const days = hours / 24;

  if (secs < 45) return t(lang, 'agoJustNow');
  if (mins < 60) return t(lang, 'agoMinutes').replace('%s', String(Math.round(mins)));
  if (hours < 24) return t(lang, 'agoHours').replace('%s', String(Math.round(hours)));
  if (days < 7) return t(lang, 'agoDays').replace('%s', String(Math.round(days)));
  if (days < 30) return t(lang, 'agoWeeks').replace('%s', String(Math.round(days / 7)));
  if (days < 365) return t(lang, 'agoMonths').replace('%s', String(Math.round(days / 30)));
  return new Date(then).toLocaleDateString(lang === 'am' ? 'am-ET' : 'en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

/**
 * The initials for a monogram avatar. One glyph for a single name, two for a
 * fuller one — works for Amharic (a Fidel is one grapheme) and Latin alike,
 * because it slices whole code points rather than assuming ASCII.
 */
export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  const first = [...parts[0]][0] ?? '';
  if (parts.length === 1) return first.toUpperCase();
  const second = [...parts[parts.length - 1]][0] ?? '';
  return (first + second).toUpperCase();
}

/**
 * A stable hue (0–359) for a name, so a given person or church keeps the same
 * avatar colour everywhere it appears. Simple string hash, not cryptographic —
 * it only has to spread names around the wheel.
 */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
