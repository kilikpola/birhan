import { useState } from 'react';
import { View, TextInput, Pressable, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import { radius } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';
import { t, type Lang } from '@/i18n';

/**
 * Password input with its own, independent show/hide state — two instances
 * (password + confirm password) never share visibility. Revealing one never
 * reveals the other.
 */
export function PasswordField({
  c,
  lang,
  label,
  value,
  onChangeText,
  onBlur,
  error,
  placeholder,
  accessibilityLabel,
}: {
  c: Palette;
  lang: Lang;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
  accessibilityLabel?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <View>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <View style={[styles.wrap, { backgroundColor: c.bg, borderColor: error ? c.danger : c.border }]}>
        <TextInput
          style={[styles.input, { color: c.text }]}
          secureTextEntry={!visible}
          value={value}
          onChangeText={onChangeText}
          onBlur={onBlur}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={accessibilityLabel ?? label}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={12}
          style={styles.eyeBtn}
          accessibilityRole="button"
          accessibilityLabel={t(lang, visible ? 'hidePassword' : 'showPassword')}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={19} color={c.textSoft} />
        </Pressable>
      </View>
      {!!error && <Text style={[styles.err, { color: c.danger }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '700', marginBottom: 8 },
  wrap: {
    height: 52,
    borderWidth: 1,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
  },
  input: { flex: 1, height: '100%', fontSize: 16 },
  eyeBtn: { paddingHorizontal: 14, height: '100%', alignItems: 'center', justifyContent: 'center' },
  err: { fontSize: 12, marginTop: 4 },
});
