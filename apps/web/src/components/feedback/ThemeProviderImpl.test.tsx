import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProviderImpl';
import { useTheme } from './ThemeContext';

const previousElectron = window.electron;
afterEach(() => {
  Object.defineProperty(window, 'electron', { configurable: true, value: previousElectron });
  window.localStorage.removeItem('puntovivo-theme-preference');
  vi.restoreAllMocks();
});

it('resolves System from the current native appearance after an override without a media event', async () => {
  let dark = false;
  window.localStorage.setItem('puntovivo-theme-preference', 'light');
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        matches: dark,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  );
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      updateThemePreference: vi.fn(async () => {
        dark = true;
      }),
    },
  });
  function Appearance() {
    const theme = useTheme();
    return (
      <button onClick={() => void theme.setPreference('system')}>{theme.resolvedTheme}</button>
    );
  }
  render(
    <ThemeProvider>
      <Appearance />
    </ThemeProvider>
  );
  expect(screen.getByRole('button')).toHaveTextContent('light');
  await act(async () => screen.getByRole('button').click());
  expect(screen.getByRole('button')).toHaveTextContent('dark');
  expect(document.documentElement).toHaveClass('dark');
});
