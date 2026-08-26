import React, { useEffect, useState } from 'react';
import { StyleSheet, ViewStyle, AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useApp } from '../theme/context';
import { radius as defaultRadius } from '../theme/tokens';

interface SkeletonProps {
  width?: number | `${number}%` | 'auto';
  height?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle | ViewStyle[];
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = defaultRadius.sm,
  style,
}: SkeletonProps) {
  const { c } = useApp();
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      setReduceMotion(enabled);
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });

    return () => {
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    if (!reduceMotion) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(0.8, { duration: 600, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        true
      );
    } else {
      opacity.value = 0.6;
    }
  }, [reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: c.surfaceAlt,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
});
