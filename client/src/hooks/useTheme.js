import { useCallback, useState } from 'react';
import { applyTheme, readStoredTheme, THEMES } from '../themes';

export function useTheme() {
  const [theme, setThemeId] = useState(readStoredTheme);

  const setTheme = useCallback((id) => {
    setThemeId(applyTheme(id));
  }, []);

  return { theme, setTheme, themes: THEMES };
}
