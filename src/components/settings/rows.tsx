import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import { radius, space, fonts } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import type { Lang } from '@/i18n';

/**
 * The pieces every Settings section is built from.
 *
 * They exist so the sections stay consistent without each one restating the
 * same padding, the same 48dp minimum target, and the same Ge'ez line height.
 * Ge'ez needs roughly 1.9x leading, and a row that sets its own height in
 * points will clip it — so rows grow with their content rather than being
 * pinned to a fixed height.
 */

/** Android's minimum touch target. Rows may grow past it, never below. */
const MIN_TARGET = 48;

export function SectionHeader({
  c,
  lang,
  title,
}: {
  c: Palette;
  lang: Lang;
  title: string;
}) {
  return (
    <View style={styles.headerWrap}>
      <Text
        style={[
          styles.header,
          { color: c.textFaint },
          lang === 'am' && styles.headerAm,
        ]}
      >
        {title}
      </Text>
    </View>
  );
}

/**
 * A quiet label for a set of choices inside a section — "Theme" above the
 * three theme options. Not a Row: a bordered row with nothing on its right
 * reads as a control that failed to load.
 */
export function SubLabel({ c, lang, text }: { c: Palette; lang: Lang; text: string }) {
  return (
    <Text
      style={[
        styles.subLabel,
        { color: c.textSoft },
        lang === 'am' && styles.subLabelAm,
      ]}
    >
      {text}
    </Text>
  );
}

/** A group of rows under one header, drawn as a single card stack. */
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
      <View style={{ gap: space.sm }}>{children}</View>
    </View>
  );
}

/**
 * Label on the left, an optional value on the right. Pressable only when it
 * has somewhere to go — a row that does nothing should not look like a button.
 */
export function Row({
  c,
  lang,
  label,
  value,
  note,
  onPress,
  danger,
  showChevron,
  right,
}: {
  c: Palette;
  lang: Lang;
  label: string;
  value?: string;
  note?: string;
  onPress?: () => void;
  danger?: boolean;
  showChevron?: boolean;
  right?: ReactNode;
}) {
  const isAm = lang === 'am';
  const colour = danger ? c.danger : c.text;

  const body = (
    <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.label, { color: colour }, isAm && styles.labelAm]}>{label}</Text>
        {note ? (
          <Text style={[styles.note, { color: c.textFaint }, isAm && styles.noteAm]}>{note}</Text>
        ) : null}
      </View>

      {value ? (
        <Text
          style={[styles.value, { color: c.textFaint }, isAm && styles.noteAm]}
          numberOfLines={2}
        >
          {value}
        </Text>
      ) : null}

      {right}
      {onPress && showChevron !== false ? (
        <Icon name="chev" size={15} color={danger ? c.danger : c.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
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
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.label, { color: c.text }, lang === 'am' && styles.labelAm]}>
            {label}
          </Text>
          {note ? (
            <Text style={[styles.note, { color: c.textFaint }, lang === 'am' && styles.noteAm]}>
              {note}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.pill,
            {
              borderColor: value ? c.accentDim : c.border,
              backgroundColor: value ? c.accentGlow : 'transparent',
            },
          ]}
        >
          <Text style={{ color: value ? c.accent : c.textFaint, fontSize: 11, fontWeight: '700' }}>
            {value ? 'ON' : 'OFF'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

export type Choice<T extends string> = { value: T; label: string; amharic?: boolean };

/**
 * A short list of mutually exclusive options, laid out as rows with a tick.
 *
 * Rows rather than a segmented control because the labels are Amharic words of
 * uneven length — squeezing "የስልኩን ተከተል" into a third of the width either
 * truncates it or shrinks the type below what a Ge'ez face stays legible at.
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
    <View style={{ gap: space.sm }}>
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <View
              style={[
                styles.row,
                {
                  backgroundColor: c.surface,
                  borderColor: active ? c.accentDim : c.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: active ? c.accent : c.text, flex: 1 },
                  o.amharic && styles.labelAm,
                ]}
              >
                {o.label}
              </Text>
              {active ? <Icon name="check" size={16} color={c.accent} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: { paddingTop: space.xl, paddingBottom: space.sm },
  header: { fontSize: 11.5, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
  // Ge'ez has no case, so uppercasing does nothing but it also must not be
  // letter-spaced apart — the glyphs stop reading as words.
  headerAm: { fontFamily: fonts.amBold, letterSpacing: 0, textTransform: 'none', fontSize: 12.5 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: MIN_TARGET + 4,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  subLabel: { fontSize: 13, fontWeight: '600', marginTop: space.sm, marginBottom: 2 },
  subLabelAm: { fontFamily: fonts.amBold, lineHeight: 25 },
  label: { fontSize: 14.5, fontWeight: '600' },
  labelAm: { fontFamily: fonts.amBold, lineHeight: 27 },
  note: { fontSize: 12, lineHeight: 18 },
  noteAm: { fontFamily: fonts.am, lineHeight: 24 },
  value: { fontSize: 13, maxWidth: '48%', textAlign: 'right' },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
