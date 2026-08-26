import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

export interface CrossProps {
  size?: number;
  color?: string;
  stroke?: number;
}

export const Cross: React.FC<CrossProps> = ({ size = 16, color = "currentColor", stroke = 1.4 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d="M12 2v20M4 8h16M7 5.2h10M7 10.8h10M9 16h6"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
    />
    <Circle cx={12} cy={8} r={2.6} stroke={color} strokeWidth={stroke} />
  </Svg>
);
