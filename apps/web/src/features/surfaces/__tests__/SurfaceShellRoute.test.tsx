import { lazy } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurfaceShellRoute } from '../SurfaceShellRoute';

vi.mock('@/components/feedback/LoadingState', () => ({
  PageLoadingState: () => <div data-testid="surface-shell-loading" />,
}));

vi.mock('@/features/modules/ModulesContext', () => ({
  useModulesSnapshot: () => ({ modules: {}, isLoading: false, isPlaceholder: false }),
  useIsModuleActive: () => true,
}));

vi.mock('react-i18next', async () => {
  const mod = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...mod,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { changeLanguage: vi.fn() },
    }),
  };
});

const LazySurfaceShell = lazy(async () => ({
  default: () => <div data-testid="lazy-surface-shell" />,
}));

describe('SurfaceShellRoute', () => {
  it('provides the Suspense boundary required by lazy top-level surface shells', async () => {
    render(
      <SurfaceShellRoute>
        <LazySurfaceShell />
      </SurfaceShellRoute>
    );

    expect(await screen.findByTestId('lazy-surface-shell')).toBeInTheDocument();
  });
});
