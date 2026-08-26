import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../skeleton';
import { useApp } from '../../theme/context';
import { radius, space } from '../../theme/tokens';

export function TodaySkeleton() {
  const { c } = useApp();

  return (
    <View style={styles.container}>
      {/* Verse of the Day Card */}
      <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Skeleton width={90} height={12} radius={radius.pill} style={{ marginBottom: space.md }} />
        <Skeleton width="100%" height={16} radius={radius.sm} style={{ marginBottom: space.xs }} />
        <Skeleton width="90%" height={16} radius={radius.sm} style={{ marginBottom: space.xs }} />
        <Skeleton width="75%" height={16} radius={radius.sm} style={{ marginBottom: space.md }} />
        <Skeleton width={110} height={14} radius={radius.sm} />
      </View>

      {/* Announcements Skeletons */}
      <View style={styles.announcementsHeader}>
        <Skeleton width={120} height={14} radius={radius.sm} />
      </View>

      {[0, 1].map((idx) => (
        <View
          key={idx}
          style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
        >
          <Skeleton width={idx === 0 ? 160 : 140} height={18} radius={radius.sm} style={{ marginBottom: space.sm }} />
          <Skeleton width="100%" height={14} radius={radius.sm} style={{ marginBottom: space.xs }} />
          <Skeleton width="85%" height={14} radius={radius.sm} style={{ marginBottom: space.md }} />
          <Skeleton width={80} height={12} radius={radius.sm} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
  },
  announcementsHeader: {
    marginTop: space.sm,
    marginBottom: space.xs,
  },
});
