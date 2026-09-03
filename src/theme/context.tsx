import React, { createContext, useContext } from 'react';
import { light, dark, type Palette } from './tokens';
import type { Lang } from '../i18n';

/**
 * How the app decides which palette to paint.
 *
 * `system` follows the phone. It is a distinct stored value rather than a
 * resolved boolean, because "dark, because I chose dark" and "dark, because
 * the phone is dark this evening" have to survive a restart differently.
 */
export type ThemeMode = 'dark' | 'light' | 'system';

/**
 * Which language scripture is shown in, which is not the same question as the
 * language of the interface. Someone may read the app in Amharic and want the
 * English text beside the Ge'ez while they study.
 */
export type ReadingLang = 'am' | 'en' | 'both';

export type AppCtx = {
  c: Palette;
  /** Resolved from themeMode — what is actually on screen right now. */
  night: boolean;
  /** Explicit dark/light. Used by the quick toggle on the Today screen, which
   *  is a deliberate choice and so leaves `system` behind. */
  setNight: (v: boolean) => void;
  themeMode: ThemeMode;
  setThemeMode: (v: ThemeMode) => void;
  /** Interface language. */
  lang: Lang;
  setLang: (v: Lang) => void;
  readingLang: ReadingLang;
  setReadingLang: (v: ReadingLang) => void;
};

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside the root layout');
  return v;
}
