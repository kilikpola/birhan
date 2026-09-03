import { createContext, useContext, useState, useEffect, useCallback } from 'react';

type ThemeCtx = {
  night: boolean;
  setNight: (v: boolean) => void;
};

const Ctx = createContext<ThemeCtx>({ night: true, setNight: () => {} });

export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [night, setNightState] = useState(() => {
    const stored = localStorage.getItem('birhan:night');
    return stored !== '0'; // default dark
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', !night);
    localStorage.setItem('birhan:night', night ? '1' : '0');
  }, [night]);

  const setNight = useCallback((v: boolean) => setNightState(v), []);

  return <Ctx.Provider value={{ night, setNight }}>{children}</Ctx.Provider>;
}
