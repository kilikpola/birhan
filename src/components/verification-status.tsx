import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Icon } from './icon';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';

export type VerificationState =
  | 'unverified'
  | 'sending'
  | 'sent'
  | 'verifying'
  | 'verified'
  | 'failed'
  | 'expired';

/**
 * Small, reusable status row for a verification state — icon, one-line
 * title, one sentence, an optional action. Deliberately not a card: this is
 * meant to sit inline in a settings row or a screen header, not dominate it.
 */
export function VerificationStatus({
  c,
  state,
  title,
  note,
  actionLabel,
  onAction,
}: {
  c: Palette;
  state: VerificationState;
  title: string;
  note?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const isBusy = state === 'sending' || state === 'verifying';
  const isGood = state === 'verified' || state === 'sent';
  const isBad = state === 'failed' || state === 'expired';
  const tint = isGood ? c.success : isBad ? c.danger : c.textSoft;

  return (
    <View style={styles.row}>
      <View style={styles.iconSlot}>
        {isBusy ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : isGood ? (
          <Icon name="check" size={17} color={tint} />
        ) : isBad ? (
          <Icon name="alert" size={17} color={tint} />
        ) : (
          <View style={[styles.dot, { borderColor: c.textFaint }]} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        {!!note && <Text style={[styles.note, { color: c.textSoft }]}>{note}</Text>}
      </View>
      {!!actionLabel && !!onAction && (
        <Pressable onPress={onAction} hitSlop={8} style={styles.actionBtn}>
          <Text style={[styles.action, { color: c.accent }]}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  iconSlot: { width: 20, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.4 },
  title: { fontSize: 14, fontWeight: '600' },
  note: { fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  actionBtn: { paddingHorizontal: space.sm, paddingVertical: 6 },
  action: { fontSize: 13, fontWeight: '700' },
});
