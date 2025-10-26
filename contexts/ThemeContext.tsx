import React from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

type Ctx = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
};

export const ThemeModeContext = React.createContext<Ctx>({ mode: 'system', setMode: () => {} });

async function getStorage() {
  try {
    const mod = await import('@react-native-async-storage/async-storage');
    // @ts-ignore
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'themeMode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = React.useState<ThemeMode>('system');

  React.useEffect(() => {
    (async () => {
      const S = await getStorage();
      try {
        const v = (await S?.getItem?.(STORAGE_KEY)) as ThemeMode | null;
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      } catch {}
    })();
  }, []);

  const setMode = React.useCallback((m: ThemeMode) => {
    setModeState(m);
    (async () => {
      const S = await getStorage();
      try { await S?.setItem?.(STORAGE_KEY, m); } catch {}
    })();
  }, []);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  return React.useContext(ThemeModeContext);
}


