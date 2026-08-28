import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';

/**
 * Backend enforces exactly one password rule — `z.string().min(8)`
 * (backend/src/routes/auth.ts, also change-password). Only that requirement
 * is shown; no invented complexity rules (uppercase, digit, symbol, ...).
 */
const MIN_LENGTH = 8;

export function PasswordRequirements({ c, lang, password }: { c: Palette; lang: Lang; password: string }) {
  if (!password) return null;

  const met = password.length >= MIN_LENGTH;

  if (met) {
    return (
      <View style={styles.row}>
        <Icon name="check" size={13} color={c.success} />
        <Text style={[styles.text, { color: c.success }]}>{t(lang, 'pwdStrongEnough')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={[styles.circle, { borderColor: c.textFaint }]} />
      <Text style={[styles.text, { color: c.textFaint }]}>{t(lang, 'pwdReqMinLength')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  circle: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.4 },
  text: { fontSize: 12.5 },
});
