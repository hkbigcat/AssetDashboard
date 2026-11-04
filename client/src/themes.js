/** Persisted theme id. The matching inline script in index.html must allow the same ids. */
export const THEME_STORAGE_KEY = 'assets-dashboard-theme';

/** Add a theme here and a `[data-theme="<id>"]` block in index.css. */
export const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export const DEFAULT_THEME = 'dark';

export function isThemeId(id) {
  return THEMES.some((theme) => theme.id === id);
}

export function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(stored)) return stored;
  } catch {
    /* private mode or blocked storage */
  }
  return DEFAULT_THEME;
}

export function applyTheme(id) {
  const theme = isThemeId(id) ? id : DEFAULT_THEME;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  return theme;
}
