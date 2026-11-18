import React from 'react';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';

export type IconName =
  | 'book' | 'note' | 'menu' | 'search' | 'play' | 'pause' | 'prev' | 'next'
  | 'down' | 'check' | 'wifiOff' | 'chevron' | 'chev' | 'back' | 'sun' | 'moon' | 'church'
  | 'globe' | 'user' | 'bookmark' | 'share' | 'reply' | 'lock' | 'send'
  | 'gear' | 'plus' | 'eyeOff' | 'eye' | 'link' | 'quote' | 'tag' | 'copy' | 'alert'
  | 'textSize' | 'close' | 'chevDown' | 'loading' | 'rewind10' | 'forward10' | 'volume' | 'volumeUp' | 'storage' | 'trash' | 'wifi' | 'wifiOff';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 20, color = 'currentColor' }) => {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'book':
      return (
        <Svg {...commonProps}>
          <Path d="M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 004 22z" />
          <Path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        </Svg>
      );
    case 'note':
      return (
        <Svg {...commonProps}>
          <Path d="M9 18V5l11-2v13" />
          <Circle cx="6" cy="18" r="3" />
          <Circle cx="17" cy="16" r="3" />
        </Svg>
      );
    case 'menu':
      return (
        <Svg {...commonProps}>
          <Path d="M4 6h16M4 12h16M4 18h16" />
        </Svg>
      );
    case 'search':
      return (
        <Svg {...commonProps}>
          <Circle cx="11" cy="11" r="7" />
          <Path d="M20 20l-3.5-3.5" />
        </Svg>
      );
    case 'play':
      return (
        <Svg {...commonProps} fill={color} stroke="none">
          <Path d="M7 4l13 8-13 8z" />
        </Svg>
      );
    case 'pause':
      return (
        <Svg {...commonProps} strokeWidth={2.4}>
          <Path d="M8 4v16M16 4v16" />
        </Svg>
      );
    case 'prev':
      return (
        <Svg {...commonProps}>
          <Path d="M18 5v14L8 12zM6 5v14" />
        </Svg>
      );
    case 'next':
      return (
        <Svg {...commonProps}>
          <Path d="M6 5v14l10-7zM18 5v14" />
        </Svg>
      );
    case 'down':
      return (
        <Svg {...commonProps}>
          <Path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
        </Svg>
      );
    case 'check':
      return (
        <Svg {...commonProps}>
          <Path d="M4 12.5l5 5L20 6" />
        </Svg>
      );
    case 'wifiOff':
      return (
        <Svg {...commonProps}>
          <Path d="M2 2l20 20" />
          <Path d="M8.5 16.5a5 5 0 017 0" />
          <Path d="M5 12.9a10 10 0 0110-1.7" />
        </Svg>
      );
    case 'chevron':
    case 'chev':
      return (
        <Svg {...commonProps}>
          <Path d="M9 5l7 7-7 7" />
        </Svg>
      );
    case 'back':
      return (
        <Svg {...commonProps}>
          <Path d="M15 5l-7 7 7 7" />
        </Svg>
      );
    case 'sun':
      return (
        <Svg {...commonProps}>
          <Circle cx="12" cy="12" r="4" />
          <Path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </Svg>
      );
    case 'moon':
      return (
        <Svg {...commonProps}>
          <Path d="M20 14A8 8 0 019.5 3.5 8.5 8.5 0 1020 14z" />
        </Svg>
      );
    case 'church':
      return (
        <Svg {...commonProps}>
          <Path d="M12 2v6M9.5 5h5" />
          <Path d="M4 21V11l8-4 8 4v10z" />
          <Path d="M10 21v-5h4v5" />
        </Svg>
      );
    case 'globe':
      return (
        <Svg {...commonProps}>
          <Circle cx="12" cy="12" r="9" />
          <Path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
        </Svg>
      );
    case 'user':
      return (
        <Svg {...commonProps}>
          <Circle cx="12" cy="8" r="4" />
          <Path d="M4 21a8 8 0 0116 0" />
        </Svg>
      );
    case 'bookmark':
      return (
        <Svg {...commonProps}>
          <Path d="M6 3h12v18l-6-5-6 5z" />
        </Svg>
      );
    case 'share':
      return (
        <Svg {...commonProps}>
          <Path d="M12 15V3M8 7l4-4 4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6" />
        </Svg>
      );
    case 'reply':
      return (
        <Svg {...commonProps}>
          <Path d="M9 14L4 9l5-5" />
          <Path d="M4 9h10a6 6 0 016 6v5" />
        </Svg>
      );
    case 'lock':
      return (
        <Svg {...commonProps}>
          <Rect x="5" y="11" width="14" height="10" rx="2" />
          <Path d="M8 11V7a4 4 0 018 0v4" />
        </Svg>
      );
    case 'send':
      return (
        <Svg {...commonProps}>
          <Path d="M4 12l16-8-6 16-2.5-6.5z" />
        </Svg>
      );
    case 'gear':
      return (
        <Svg {...commonProps}>
          <Circle cx="12" cy="12" r="3" />
          <Path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </Svg>
      );
    case 'plus':
      return (
        <Svg {...commonProps}>
          <Path d="M12 5v14M5 12h14" />
        </Svg>
      );
    case 'link':
      return (
        <Svg {...commonProps}>
          <Path d="M10 14a5 5 0 007.07 0l1.93-1.93a5 5 0 00-7.07-7.07L10.5 6.5" />
          <Path d="M14 10a5 5 0 00-7.07 0L5 11.93a5 5 0 007.07 7.07L13.5 17.5" />
        </Svg>
      );
    case 'quote':
      return (
        <Svg {...commonProps}>
          <Path d="M7 8c-2 1-3 3-3 5.5S5.5 17 8 17s3.5-1.5 3.5-3.5S10 10 8 10c0-1.2 1-2.2 2-2.5" />
          <Path d="M16 8c-2 1-3 3-3 5.5s1.5 3.5 4 3.5 3.5-1.5 3.5-3.5S19 10 17 10c0-1.2 1-2.2 2-2.5" />
        </Svg>
      );
    case 'tag':
      return (
        <Svg {...commonProps}>
          <Path d="M3 12.5L11.5 4H19a1 1 0 011 1v7.5l-8.5 8.5a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8z" />
          <Circle cx="15.5" cy="8.5" r="1.4" />
        </Svg>
      );
    case 'copy':
      return (
        <Svg {...commonProps}>
          <Rect x="9" y="9" width="11" height="11" rx="2" />
          <Path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </Svg>
      );
    case 'textSize':
      // "Aa": a large A and a small one, sharing a baseline.
      return (
        <Svg {...commonProps}>
          <Path d="M3 19l5.5-14L14 19" />
          <Path d="M5.2 13.5h6.6" />
          <Path d="M15 19l3.5-8.5L22 19" />
          <Path d="M16.3 16h4.4" />
        </Svg>
      );
    case 'chevDown':
      return (
        <Svg {...commonProps}>
          <Path d="M6 9l6 6 6-6" />
        </Svg>
      );
    case 'close':
      return (
        <Svg {...commonProps}>
          <Path d="M6 6l12 12M18 6L6 18" />
        </Svg>
      );
    case 'loading':
      return (
        <Svg {...commonProps}>
          <Circle cx="12" cy="12" r="8" strokeDasharray="32 32" strokeDashoffset="0" fill="none" strokeWidth={2.5} />
        </Svg>
      );
    case 'rewind10':
      return (
        <Svg {...commonProps}>
          <Path d="M11 18V6l-8.5 6 8.5 6z" />
          <Path d="M13 18V6l-8.5 6 8.5 6z" />
        </Svg>
      );
    case 'forward10':
      return (
        <Svg {...commonProps}>
          <Path d="M13 6v12l8.5-6-8.5-6z" />
          <Path d="M11 6v12l8.5-6-8.5-6z" />
        </Svg>
      );
    case 'volume':
      return (
        <Svg {...commonProps}>
          <Path d="M5 9v6h3l4 4V5L8 9H5z" />
        </Svg>
      );
    case 'volumeUp':
      return (
        <Svg {...commonProps}>
          <Path d="M5 9v6h3l4 4V5L8 9H5z" />
          <Path d="M14 6.5a3 3 0 010 11" />
          <Path d="M17 4.5a6 6 0 010 15" />
        </Svg>
      );
    case 'storage':
      return (
        <Svg {...commonProps}>
          <Path d="M21 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v3" />
          <Path d="M21 16V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h14a2 2 0 002-2z" />
          <Path d="M4 16v6M20 16v6" />
        </Svg>
      );
    case 'trash':
      return (
        <Svg {...commonProps}>
          <Path d="M4 7h16M10 11v6M14 11v6M19 7H6l-1 15h14L19 7z" />
        </Svg>
      );
    case 'wifi':
      return (
        <Svg {...commonProps}>
          <Path d="M5 12.55a11 11 0 0114.08 0" />
          <Path d="M1.42 9a16 16 0 0121.16 0" />
          <Path d="M8.53 16.11a6 6 0 016.94 0" />
          <Line x1="12" y1="20" x2="12.01" y2="20" />
        </Svg>
      );
    case 'eye':
      return (
        <Svg {...commonProps}>
          <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <Circle cx="12" cy="12" r="3" />
        </Svg>
      );
    case 'eyeOff':
      return (
        <Svg {...commonProps}>
          <Path d="M2 2l20 20" />
          <Path d="M10.6 6.2A9 9 0 0122 12a17 17 0 01-3 3.8" />
          <Path d="M6.6 6.7A17 17 0 002 12a9.6 9.6 0 0013.3 4.3" />
        </Svg>
      );
    default:
      return null;
  }
};
