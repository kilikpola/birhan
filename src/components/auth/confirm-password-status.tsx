import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';

/** Live match feedback as the user types the confirmation — never waits for
 * blur or submit. Silent until they've actually started confirming. */
export function ConfirmPasswordStatus({
  c,
  lang,
  password,
  confirmPassword,
}: {
  c: Palette;
  lang: Lang;
  password: string;
  confirmPassword: string;
}) {
  if (!confirmPassword) return null;

  const matches = confirmPassword === password;

  return (
    <View style={styles.row}>
      {matches ? (
        <>
          <Icon name="check" size={13} color={c.success} />
          <Text style={[styles.text, { color: c.success }]}>{t(lang, 'pwdMatch')}</Text>
        </>
      ) : (
        <Text style={[styles.text, { color: c.textFaint }]}>{t(lang, 'pwdNotMatchYet')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  text: { fontSize: 12.5 },
});
