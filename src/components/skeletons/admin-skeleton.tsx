import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../skeleton';
import { useApp } from '../../theme/context';
import { radius, space } from '../../theme/tokens';

export function AdminSkeleton({ count = 5 }: { count?: number }) {
  const { c } = useApp();

  return (
    <View style={styles.container}>
      {/* Member Count Header Skeleton */}
      <View style={[styles.countCard, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Skeleton width={100} height={12} radius={radius.pill} style={{ marginBottom: space.xs }} />
        <Skeleton width={130} height={24} radius={radius.sm} />
      </View>

      {/* Roster Rows Skeleton */}
      {Array.from({ length: count }).map((_, idx) => (
        <View
          key={idx}
          style={[styles.row, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          {/* Avatar circle */}
          <Skeleton width={36} height={36} radius={18} />

          {/* Name and branch stack */}
          <View style={styles.textStack}>
            <Skeleton width={idx % 2 === 0 ? 140 : 110} height={16} radius={radius.sm} />
            <Skeleton width={idx % 2 === 0 ? 90 : 120} height={12} radius={radius.sm} style={{ marginTop: 4 }} />
          </View>

          {/* Role badge */}
          <Skeleton width={54} height={20} radius={radius.pill} />
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
  countCard: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.sm,
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
