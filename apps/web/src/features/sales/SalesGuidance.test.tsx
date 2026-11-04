import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';
import { SalesCheckoutPanel } from './SalesCheckoutPanel';
import { SalesQuickSearchBar } from './SalesQuickSearchBar';

vi.mock('@/features/sales/useCashierPace', () => ({
  useCashierPace: () => ({ enabled: false, toggle: vi.fn(), pace: null }),
}));

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

function renderGuidance(itemCount = 0, locked = false) {
  return render(
    <>
      <SalesQuickSearchBar
        query=""
        onQueryChange={vi.fn()}
        onSubmit={vi.fn()}
        inputRef={createRef<HTMLInputElement>()}
        disabled={locked}
      />
      <SalesCheckoutPanel
        currentSite={null}
        cashSession={null}
        registerAssignments={[]}
        selectedRegisterAssignment={null}
        isCashSessionLoading={false}
        draftSummary={{ itemCount, subtotal: 0, taxAmount: 0, total: 0 }}
        canCharge={false}
        canOpenCashSession={false}
        canCloseCashSession={false}
        canOpenSearch={!locked}
        onOpenSearch={vi.fn()}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        onCloseCashSession={vi.fn()}
        onOpenMovement={vi.fn()}
        onRegisterAssignmentChange={vi.fn()}
      />
    </>
  );
}

describe.each([
  {
    locale: 'en',
    search: 'Search products',
    items: 'Items (2)',
    obsolete: /Quick suggestion|Waiting…|when wired|reuses the existing|Last scanned/,
  },
  {
    locale: 'es',
    search: 'Buscar productos',
    items: 'Ítems (2)',
    obsolete:
      /Sugerencia rápida|Esperando…|cuando estén disponibles|reutiliza el diálogo|Último escaneado/,
  },
])('sales guidance in $locale', ({ locale, search, items, obsolete }) => {
  it('keeps empty checkout actionable without inert suggestions or internal copy', async () => {
    await i18n.changeLanguage(locale);
    const { container } = renderGuidance();
    expect(screen.getByRole('button', { name: search })).toBeEnabled();
    expect(container.textContent).not.toMatch(obsolete);
  });

  it('renders shortcut keys as keyboard input, not literal Markdown', async () => {
    await i18n.changeLanguage(locale);
    const { container } = renderGuidance();
    const hint = container.querySelector('.sales-scan-hint')!;
    expect(Array.from(hint.querySelectorAll('kbd'), key => key.textContent)).toEqual([
      'Alt+P',
      'F5',
      'F1',
    ]);
    const panelKeys = Array.from(container.querySelectorAll('aside kbd'), key => key.textContent);
    expect(panelKeys).toEqual(expect.arrayContaining(['Alt+P', 'Alt+C', 'Alt+D', 'Alt+U']));
    expect(container.textContent).not.toContain('`');
    expect(hint.textContent).toContain(locale === 'en' ? 'Focus search' : 'Ir a la búsqueda');
  });

  it('describes cart contents rather than claiming to identify the last scan', async () => {
    await i18n.changeLanguage(locale);
    const { container } = renderGuidance(2);
    expect(screen.getByTestId('checkout-total')).toHaveTextContent(items);
    expect(container.textContent).not.toMatch(obsolete);
  });

  it('does not advertise editing shortcuts on a locked ticket', async () => {
    await i18n.changeLanguage(locale);
    const { container } = renderGuidance(2, true);
    expect(screen.getByRole('button', { name: search })).toBeDisabled();
    const keys = Array.from(container.querySelectorAll('kbd'), key => key.textContent);
    expect(keys).not.toEqual(expect.arrayContaining(['Alt+P']));
    expect(keys).not.toEqual(expect.arrayContaining(['Alt+C']));
    expect(keys).not.toEqual(expect.arrayContaining(['Alt+D']));
    expect(keys).not.toEqual(expect.arrayContaining(['Alt+U']));
    expect(container.querySelector('.sales-scan-hint kbd')).toBeNull();
  });
});
