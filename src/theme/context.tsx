import React, { createContext, useContext } from 'react';
import { light, dark, type Palette } from './tokens';
import type { Lang } from '../i18n';

export type AppCtx = {
  c: Palette;
  night: boolean;
  setNight: (v: boolean) => void;
  lang: Lang;
  setLang: (v: Lang) => void;
};

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside the root layout');
  return v;
}
