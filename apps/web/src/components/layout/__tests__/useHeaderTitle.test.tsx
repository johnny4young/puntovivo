import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useHeaderTitle } from '../useHeaderTitle';

function wrapperFor(pathname: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>;
  };
}

describe('useHeaderTitle', () => {
  it('maps workspace landing routes to their own header keys', () => {
    const cases = [
      ['/catalog', 'nav:header.catalog.title'],
      ['/procurement', 'nav:header.procurement.title'],
      ['/finance', 'nav:header.finance.title'],
      ['/data-import', 'nav:header.dataImport.title'],
      ['/day-close', 'nav:header.dayClose.title'],
    ] as const;

    for (const [pathname, titleKey] of cases) {
      const { result } = renderHook(() => useHeaderTitle(), {
        wrapper: wrapperFor(pathname),
      });
      expect(result.current.titleKey).toBe(titleKey);
    }
  });
});
