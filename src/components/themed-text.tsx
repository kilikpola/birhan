import { Platform, StyleSheet, Text, type TextProps } from 'react-native';
import { useApp } from '@/theme/context';
import { fonts } from '@/theme/tokens';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'title' | 'small' | 'smallBold' | 'subtitle' | 'link' | 'code' | 'verse' | 'reflection' | 'eyebrow';
  colorType?: 'text' | 'textSoft' | 'textFaint' | 'accent' | 'lapis' | 'success' | 'danger' | 'bg' | 'surface' | 'border';
  isAmharic?: boolean;
};

export function ThemedText({ style, type = 'default', colorType = 'text', isAmharic, ...rest }: ThemedTextProps) {
  const { c: colors, lang: locale } = useApp();

  const useAmFont = isAmharic || (isAmharic === undefined && locale === 'am');

  // The Ethiopic font is registered under its explicit weight family names
  // (fonts.am / fonts.amBold). Android does NOT synthesize a bold Ethiopic from
  // the regular file, so bold contexts must select the bold family by name —
  // relying on fontWeight would leave Amharic bold text un-bolded (or, with the
  // old 'NotoSerifEthiopic' literal, fall back to the system serif entirely).
  const boldType = type === 'title' || type === 'subtitle' || type === 'smallBold' || type === 'eyebrow';
  const styleWeight = StyleSheet.flatten(style)?.fontWeight;
  const isBold = boldType || styleWeight === '700' || styleWeight === 700 || styleWeight === 'bold';
  const amFamily = isBold ? fonts.amBold : fonts.am;
  const fontFamily = useAmFont ? amFamily : (Platform.OS === 'ios' ? 'Georgia' : 'serif');

  return (
    <Text
      style={[
        { color: colors[colorType], fontFamily },
        type === 'default' && styles.default,
        type === 'title' && styles.title,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'code' && styles.code,
        type === 'verse' && (useAmFont ? styles.verseAm : styles.verseEn),
        type === 'reflection' && styles.reflection,
        type === 'eyebrow' && styles.eyebrow,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 15,
    lineHeight: 22,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  subtitle: {
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  small: {
    fontSize: 12,
    lineHeight: 18,
  },
  smallBold: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  link: {
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: 'underline',
  },
  verseAm: {
    fontSize: 19,
    lineHeight: 34,
  },
  verseEn: {
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
  },
  reflection: {
    fontSize: 14,
    lineHeight: 22,
  },
  code: {
    fontFamily: Platform.select({ ios: 'Courier', android: 'monospace' }),
    fontSize: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
});
