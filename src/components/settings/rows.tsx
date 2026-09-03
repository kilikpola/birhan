import { Children, type ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import { radius, space, fonts } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import type { Lang } from '@/i18n';

/**
 * The pieces every Settings section is built from.
 *
 * The layout rule that matters: a group of related rows is ONE card with
 * hairline dividers between the rows — not one bordered card per row. Boxing
 * every row separately turns a section of eight choices into eight stacked
 * rectangles, which is heavy, repetitive, and wastes the vertical space that
 * matters most on the small Android screens this app is used on. It also
 * destroys the grouping: if every row looks equally separate, nothing tells
 * you which rows belong together.
 *
 * Ge'ez needs roughly 1.9x leading, so rows grow with their content instead of
 * being pinned to a height in points, which would clip it.
 */

/** Android's minimum touch target. Rows may grow past it, never below. */
const MIN_TARGET = 48;

export function SectionHeader({ c, lang, title }: { c: Palette; lang: Lang; title: string }) {
  return (
    <View style={styles.headerWrap}>
      <Text style={[styles.header, { color: c.textFaint }, lang === 'am' && styles.headerAm]}>
        {title}
      </Text>
    </View>
  );
}

/** A quiet label for a set of choices inside a card ("Theme", "Reading language"). */
export function SubLabel({ c, lang, text }: { c: Palette; lang: Lang; text: string }) {
  return (
    <Text style={[styles.subLabel, { color: c.textFaint }, lang === 'am' && styles.subLabelAm]}>
      {text}
    </Text>
  );
}

/**
 * One card holding a run of rows, with a hairline between each.
 *
 * The divider is inset to the text column rather than running edge to edge, so
 * the eye reads the rows as one block instead of a stack of separate strips.
 */
export function Card({ c, children }: { c: Palette; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {items.map((child, i) => (
        <View key={i}>
          {i > 0 ? <View style={[styles.divider, { backgroundColor: c.border }]} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** A section header followed by one card of rows. */
export function Section({
  c,
  lang,
  title,
  children,
}: {
  c: Palette;
  lang: Lang;
  title: string;
  children: ReactNode;
}) {
  return (
    <View>
      <SectionHeader c={c} lang={lang} title={title} />
      {children}
    </View>
  );
}

/**
 * Label left, value right. Pressable only when it has somewhere to go — a row
 * that does nothing should not look like a button.
 *
 * Label and value share the first text line so they align on the same baseline;
 * the note sits underneath the label, never pushing the value off-centre.
 */
export function Row({
  c,
  lang,
  label,
  value,
  note,
  onPress,
  danger,
  accent,
  right,
}: {
  c: Palette;
  lang: Lang;
  label: string;
  value?: string;
  note?: string;
  onPress?: () => void;
  danger?: boolean;
  accent?: boolean;
  right?: ReactNode;
}) {
  const isAm = lang === 'am';
  const colour = danger ? c.danger : accent ? c.accent : c.text;

  const body = (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.label, { color: colour }, isAm && styles.labelAm]}>{label}</Text>
          {value ? (
            <Text
              style={[styles.value, { color: c.textFaint }, isAm && styles.valueAm]}
              numberOfLines={2}
            >
              {value}
            </Text>
          ) : null}
          {right}
          {onPress ? (
            <Icon name="chev" size={15} color={danger ? c.danger : c.textFaint} />
          ) : null}
        </View>
        {note ? (
          <Text style={[styles.note, { color: c.textFaint }, isAm && styles.noteAm]}>{note}</Text>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" android_ripple={{ color: c.border }}>
      {body}
    </Pressable>
  );
}

/** An on/off row. The pill doubles as the state readout. */
export function ToggleRow({
  c,
  lang,
  label,
  note,
  value,
  onToggle,
}: {
  c: Palette;
  lang: Lang;
  label: string;
  note?: string;
  value: boolean;
  onToggle: () => void;
}) {
  const isAm = lang === 'am';
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      android_ripple={{ color: c.border }}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <View style={styles.rowTop}>
            <Text style={[styles.label, { color: c.text }, isAm && styles.labelAm]}>{label}</Text>
            <View
              style={[
                styles.pill,
                {
                  borderColor: value ? c.accentDim : c.border,
                  backgroundColor: value ? c.accentGlow : 'transparent',
                },
              ]}
            >
              <Text
                style={{ color: value ? c.accent : c.textFaint, fontSize: 11, fontWeight: '700' }}
              >
                {value ? 'ON' : 'OFF'}
              </Text>
            </View>
          </View>
          {note ? (
            <Text style={[styles.note, { color: c.textFaint }, isAm && styles.noteAm]}>{note}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export type Choice<T extends string> = { value: T; label: string; amharic?: boolean };

/**
 * A short list of mutually exclusive options, as plain rows with a tick on the
 * chosen one. No border per option — they sit inside the section's card like
 * any other row, so a group of choices reads as one block.
 */
export function ChoiceRows<T extends string>({
  c,
  lang,
  selected,
  options,
  onSelect,
}: {
  c: Palette;
  lang: Lang;
  selected: T;
  options: Choice<T>[];
  onSelect: (v: T) => void;
}) {
  return (
    <>
      {options.map((o, i) => {
        const active = o.value === selected;
        return (
          <View key={o.value}>
            {i > 0 ? <View style={[styles.divider, { backgroundColor: c.border }]} /> : null}
            <Pressable
              onPress={() => onSelect(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              android_ripple={{ color: c.border }}
            >
              <View style={styles.row}>
                <View style={styles.rowTop}>
                  <Text
                    style={[
                      styles.label,
                      { color: active ? c.accent : c.text },
                      o.amharic && styles.labelAm,
                    ]}
                  >
                    {o.label}
                  </Text>
                  {active ? <Icon name="check" size={16} color={c.accent} /> : null}
                </View>
              </View>
            </Pressable>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingTop: space.xl, paddingBottom: space.sm },
  header: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  // Ge'ez has no case, so uppercasing does nothing, and letter-spacing pulls
  // the glyphs apart until they stop reading as words.
  headerAm: { fontFamily: fonts.amBold, letterSpacing: 0, textTransform: 'none', fontSize: 12.5 },

  // One border for the whole group, not one per row.
  card: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  // Inset to the text column so rows read as one block.
  divider: { height: StyleSheet.hairlineWidth, marginLeft: space.md },

  row: {
    minHeight: MIN_TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  // Label and value share this line, so they sit on the same baseline.
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },

  label: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  labelAm: { fontFamily: fonts.amBold, lineHeight: 27 },
  value: { fontSize: 13, maxWidth: '52%', textAlign: 'right' },
  valueAm: { fontFamily: fonts.am, lineHeight: 24 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  noteAm: { fontFamily: fonts.am, lineHeight: 22, marginTop: 2 },

  subLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  subLabelAm: { fontFamily: fonts.amBold, letterSpacing: 0, textTransform: 'none', fontSize: 12 },

  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
