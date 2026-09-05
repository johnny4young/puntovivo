import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNoA11yViolations } from '@/test/a11y';

const { persistLanguage, changeLanguage } = vi.hoisted(() => ({
  persistLanguage: vi.fn(),
  changeLanguage: vi.fn(),
}));

vi.mock('@/i18n/resolveLocale', () => ({
  readLanguagePreference: () => 'system',
  persistLanguagePreference: persistLanguage,
  resolveBootLocale: () => 'es',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage },
  }),
}));

import { CustomerDisplayShell } from '../CustomerDisplayShell';

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/customer-display']}>
      <Routes>
        <Route path="/customer-display" element={<CustomerDisplayShell />}>
          <Route index element={<p>customer display body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  changeLanguage.mockResolvedValue(undefined);
});

describe('CustomerDisplayShell', () => {
  it('hosts the authority-free privacy-minimal display chrome', () => {
    renderShell();
    expect(screen.getByTestId('customer-display-shell')).toHaveTextContent(
      'customerDisplay:shell.product'
    );
    expect(screen.getByText('customer display body')).toBeInTheDocument();
  });

  it('persists the display language through the canonical locale resolver', () => {
    renderShell();
    fireEvent.change(screen.getByRole('combobox', { name: 'customerDisplay:shell.language' }), {
      target: { value: 'es' },
    });
    expect(persistLanguage).toHaveBeenCalledWith('es');
    expect(changeLanguage).toHaveBeenCalledWith('es');
  });

  it('closes only the display window instead of mutating the POS session', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    renderShell();
    fireEvent.click(screen.getByTestId('customer-display-close'));
    expect(close).toHaveBeenCalledOnce();
  });

  it('has no serious WCAG violations', async () => {
    const { container } = renderShell();
    await assertNoA11yViolations(container);
  });
});
