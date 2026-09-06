import { initials, hueFor } from '../lib/format';

/**
 * A monogram avatar: the person's or church's initials on a soft, name-derived
 * colour. Gives every row a face so the console reads as people and places, not
 * database rows. The colour is a tint (not a loud fill) so a list of them stays
 * calm and works in both themes.
 */
export function Avatar({
  name,
  size = 40,
  square = false,
}: {
  name: string;
  /** Square, softer-cornered variant for churches/branches; round for people. */
  square?: boolean;
  size?: number;
}) {
  const hue = hueFor(name || '?');
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: square ? Math.round(size * 0.28) : '50%',
        background: `hsl(${hue} 55% 50% / 0.16)`,
        color: `hsl(${hue} 62% 62%)`,
        fontSize: Math.round(size * 0.38),
      }}
    >
      {initials(name)}
    </span>
  );
}
