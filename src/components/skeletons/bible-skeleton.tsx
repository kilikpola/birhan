import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../skeleton';
import { useApp } from '../../theme/context';
import { radius, space } from '../../theme/tokens';

const LINE_WIDTHS = ['100%', '85%', '92%', '70%', '96%', '80%', '88%'] as const;

export function BibleSkeleton() {
  const { c } = useApp();

  return (
    <View style={[styles.manuscript, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={[styles.spine, { backgroundColor: c.borderLit }]} />
      
      {/* Header title block */}
      <View style={styles.header}>
        <Skeleton width={140} height={22} radius={radius.sm} />
        <Skeleton width={60} height={14} radius={radius.pill} />
      </View>

      {/* Verse lines */}
      <View style={styles.verseContainer}>
        {LINE_WIDTHS.map((w, idx) => (
          <View key={idx} style={styles.verseRow}>
            <Skeleton width={20} height={16} radius={4} style={{ marginRight: space.sm }} />
            <Skeleton width={w} height={16} radius={radius.sm} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  manuscript: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
    paddingLeft: space.lg + 4,
    position: 'relative',
    marginHorizontal: space.lg,
    marginTop: space.md,
  },
  spine: {
    position: 'absolute',
    left: 0,
    top: 14,
    bottom: 14,
    width: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  verseContainer: {
    gap: space.md,
  },
  verseRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
