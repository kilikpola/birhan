/**
 * Birhan — theme tokens v2 (dark-first)
 *
 * Direction: near-black surfaces, crisp elevation, generous radii,
 * one warm accent. Tamagui-adjacent structure, but the accent is drawn
 * from Ethiopian manuscript illumination — gold leaf and lapis — not a
 * generic acid green.
 *
 * The thesis: the app is called ብርሃን, "light." On a dark ground, the
 * accent IS light. Genesis 1:3 is the app's own verse of the day.
 * So: darkness is the surface, gold is the content.
 *
 * Dark is the DEFAULT. Light is the alternate (for bright sun, which
 * matters — people read this outdoors).
 */

export const dark = {
  // surfaces, lightest to deepest
  bg:        '#0B0B0D',   // app ground, near-black with a blue cast
  surface:   '#141417',   // cards
  surfaceAlt:'#1C1C21',   // raised / pressed
  border:    '#26262C',   // hairlines — barely visible, does the structural work
  borderLit: '#35353D',   // active borders

  // text
  text:      '#F2EFE9',   // warm white, not pure — easier on the eye at night
  textSoft:  '#9B968D',
  textFaint: '#63605A',

  // accent — gold leaf
  accent:    '#E3A93C',
  accentDim: '#8A671F',
  accentGlow:'rgba(227,169,60,0.12)',

  // secondary — lapis, for links / info
  lapis:     '#5B8BD0',
  // states
  success:   '#5FA771',
  danger:    '#D2564B',
} as const;

export const light = {
  bg:        '#FAF8F4',
  surface:   '#FFFFFF',
  surfaceAlt:'#F1EDE5',
  border:    '#E2DDD2',
  borderLit: '#CFC7B8',

  text:      '#17161A',
  textSoft:  '#5B564E',
  textFaint: '#8D877D',

  accent:    '#A8761C',
  accentDim: '#D6BE8A',
  accentGlow:'rgba(168,118,28,0.10)',

  lapis:     '#2F5FA6',
  success:   '#3F7A52',
  danger:    '#B03A30',
} as const;

export type Palette = {
  readonly bg: string;
  readonly surface: string;
  readonly surfaceAlt: string;
  readonly border: string;
  readonly borderLit: string;

  readonly text: string;
  readonly textSoft: string;
  readonly textFaint: string;

  readonly accent: string;
  readonly accentDim: string;
  readonly accentGlow: string;

  readonly lapis: string;
  readonly success: string;
  readonly danger: string;
};

export const fonts = {
  /** Ge'ez — BUNDLED via expo-font, never fetched */
  am:     'NotoSerifEthiopic_400Regular',
  amBold: 'NotoSerifEthiopic_700Bold',
  /** UI — Inter. Clean, high x-height, reads well at small sizes on cheap screens */
  ui:     'Inter_400Regular',
  uiMed:  'Inter_500Medium',
  uiBold: 'Inter_700Bold',
} as const;

/** 4pt base scale */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Generous radii — the main visual shift from the old flat sheet look */
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;

export const type = {
  display: { fontSize: 28, lineHeight: 34, letterSpacing: -0.5 },
  title:   { fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  body:    { fontSize: 15, lineHeight: 22 },
  small:   { fontSize: 13, lineHeight: 18 },
  micro:   { fontSize: 11, lineHeight: 15, letterSpacing: 0.4 },
  /** Ge'ez needs more leading — the glyphs are tall and dense */
  scripture:   { fontSize: 18, lineHeight: 34 },
  scriptureSm: { fontSize: 16, lineHeight: 30 },
} as const;

/** Elevation via border + subtle glow, not heavy drop shadows */
export const elevation = {
  card: {
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
} as const;
