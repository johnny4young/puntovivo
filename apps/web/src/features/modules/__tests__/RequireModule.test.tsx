/**
 * RequireModule render-side gate.
 *
 * Pins the contract every gated route + sidebar item relies on:
 * - Active module → children render.
 * - Inactive module → fallback (default null) renders.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { useIsModuleActiveMock } = vi.hoisted(() => ({
  useIsModuleActiveMock: vi.fn(),
}));

vi.mock('../ModulesContext', () => ({
  useIsModuleActive: (id: string) => useIsModuleActiveMock(id),
}));

import { RequireModule } from '../RequireModule';

beforeEach(() => {
  useIsModuleActiveMock.mockReset();
});

describe('RequireModule', () => {
  it('renders children when the module is active', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    render(
      <RequireModule id="copilot">
        <span data-testid="child">visible</span>
      </RequireModule>
    );
    expect(screen.getByTestId('child')).toHaveTextContent('visible');
  });

  it('renders nothing by default when the module is inactive', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    render(
      <RequireModule id="copilot">
        <span data-testid="child">visible</span>
      </RequireModule>
    );
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('renders the fallback when one is provided and the module is inactive', () => {
    useIsModuleActiveMock.mockReturnValue(false);
    render(
      <RequireModule id="quotations" fallback={<span data-testid="fallback">disabled</span>}>
        <span data-testid="child">visible</span>
      </RequireModule>
    );
    expect(screen.queryByTestId('child')).toBeNull();
    expect(screen.getByTestId('fallback')).toHaveTextContent('disabled');
  });

  it('forwards the requested id to the hook (the gate is per-module)', () => {
    useIsModuleActiveMock.mockReturnValue(true);
    render(
      <RequireModule id="anomaly-detection">
        <span>x</span>
      </RequireModule>
    );
    expect(useIsModuleActiveMock).toHaveBeenCalledWith('anomaly-detection');
  });
});
