import { useState, type ReactNode } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/icon';
import { radius, space } from '@/theme/tokens';
import type { Palette } from '@/theme/tokens';

export function CollapsibleSection({
  title,
  count,
  defaultOpen,
  colors,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen: boolean;
  colors: Palette;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
        style={styles.header}
      >
        <ThemedText type="smallBold" colorType="text" style={{ flex: 1 }}>
          {title}{typeof count === 'number' ? ` (${count})` : ''}
        </ThemedText>
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chev" size={16} color={colors.textFaint} />
        </View>
      </TouchableOpacity>
      {open && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: radius.md,
    marginBottom: space.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  body: {
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
});
