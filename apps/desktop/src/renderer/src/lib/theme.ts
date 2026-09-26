import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const STORAGE_KEY = 'arlo-theme';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function savedTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return isThemePreference(saved) ? saved : 'light';
}

export function resolvedTheme(theme: ThemePreference): Theme {
  if (theme !== 'system') return theme;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyTheme(theme: ThemePreference): void {
  if (typeof document !== 'undefined')
    document.documentElement.dataset.theme = resolvedTheme(theme);
}

export function applySavedTheme(): void {
  applyTheme(savedTheme());
  if (typeof window === 'undefined') return;

  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyTheme(savedTheme());
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (savedTheme() === 'system') applyTheme('system');
  });
}

export function useTheme(): readonly [ThemePreference, (theme: ThemePreference) => void] {
  const [theme, setTheme] = useState(savedTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && isThemePreference(event.newValue)) setTheme(event.newValue);
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  return [theme, setTheme] as const;
}
