import { Fragment } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '@/components/icon';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';

/**
 * Registration progress. Shows which steps are done, which is active, and what
 * remains — not just "2 of 3".
 *
 * Takes however many labels it is given rather than a fixed pair, because the
 * flow grew a third step (connecting Telegram) and will not necessarily stop
 * there.
 */
export function StepIndicator({
  c,
  step,
  labels,
}: {
  c: Palette;
  /** 1-based. */
  step: number;
  labels: string[];
}) {
  return (
    <View style={styles.row}>
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'active' : 'pending';
        return (
          <Fragment key={label}>
            {i > 0 ? (
              <View
                style={[
                  styles.connector,
                  { backgroundColor: n <= step ? c.accent : c.border },
                ]}
              />
            ) : null}
            <Node c={c} label={label} state={state} />
          </Fragment>
        );
      })}
    </View>
  );
}

function Node({ c, label, state }: { c: Palette; label: string; state: 'done' | 'active' | 'pending' }) {
  const tint = state === 'pending' ? c.textFaint : c.accent;
  return (
    <View style={styles.node}>
      <View
        style={[
          styles.badge,
          {
            borderColor: tint,
            backgroundColor: state === 'active' ? c.accentGlow : 'transparent',
          },
        ]}
      >
        {state === 'done' ? (
          <Icon name="check" size={12} color={c.accent} />
        ) : (
          <View style={[styles.dot, { backgroundColor: tint }]} />
        )}
      </View>
      <Text style={[styles.label, { color: state === 'pending' ? c.textFaint : c.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  node: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  badge: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  connector: { flex: 1, height: 1.4, marginHorizontal: space.sm, minWidth: 12 },
});
