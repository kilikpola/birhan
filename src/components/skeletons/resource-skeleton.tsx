import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../skeleton';
import { useApp } from '../../theme/context';
import { radius, space } from '../../theme/tokens';

export function ResourceSkeleton({ count = 5 }: { count?: number }) {
  const { c } = useApp();

  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, idx) => (
        <View
          key={idx}
          style={[
            styles.row,
            { backgroundColor: c.surface, borderColor: c.border },
          ]}
        >
          {/* File icon placeholder */}
          <Skeleton width={36} height={36} radius={radius.sm} />

          {/* Title and date stack */}
          <View style={styles.textStack}>
            <Skeleton width={idx % 2 === 0 ? 160 : 130} height={16} radius={radius.sm} />
            <Skeleton width={idx % 2 === 0 ? 100 : 80} height={12} radius={radius.sm} style={{ marginTop: 6 }} />
          </View>

          {/* File size chip pill */}
          <Skeleton width={60} height={22} radius={radius.pill} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  textStack: {
    flex: 1,
    marginLeft: space.md,
  },
});
