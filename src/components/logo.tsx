import React from 'react';
import { Image } from 'expo-image';
import { StyleProp, ImageStyle } from 'react-native';
import { radius } from '../theme/tokens';

export const LOGO_SOURCE = require('@/assets/images/birhanlogo.png');

export interface LogoProps {
  /** Rendered edge length in dp — the mark is square. */
  size?: number;
  /** Corner rounding; defaults to the app's card radius. */
  rounded?: number;
  style?: StyleProp<ImageStyle>;
}

/**
 * The Birhan brand mark. Single source for the logo everywhere it appears in
 * the app, so swapping birhanlogo.png updates every surface at once.
 */
export const Logo: React.FC<LogoProps> = ({ size = 72, rounded = radius.md, style }) => (
  <Image
    source={LOGO_SOURCE}
    accessibilityLabel="Birhan"
    contentFit="contain"
    style={[{ width: size, height: size, borderRadius: rounded }, style]}
  />
);
