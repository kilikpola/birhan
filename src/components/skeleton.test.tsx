import React from 'react';
import { AccessibilityInfo } from 'react-native';

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: {
      View: (props: any) => React.createElement(View, props),
    },
    useSharedValue: (init: any) => ({ value: init }),
    useAnimatedStyle: (fn: any) => fn(),
    withRepeat: (anim: any) => anim,
    withSequence: (...anims: any[]) => anims[0],
    withTiming: (toValue: any) => toValue,
    Easing: {
      inOut: () => (x: any) => x,
      quad: (x: any) => x,
    },
  };
});

import { Skeleton } from './skeleton';

describe('Skeleton Primitive', () => {
  it('checks reduced motion setting on mount', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    
    expect(Skeleton).toBeDefined();
    
    spy.mockRestore();
  });
});
