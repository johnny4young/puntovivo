import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import i18n from '@/i18n';
import { SalesCheckoutPanel } from './SalesCheckoutPanel';
import { SalesQuickSearchBar } from './SalesQuickSearchBar';
import { SalesShortcutStrip } from './SalesShortcutStrip';

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
        lineCount={itemCount}
        canCharge={false}
        canOpenCashSession={false}
        canCloseCashSession={false}
        onCharge={vi.fn()}
        onOpenCashSession={vi.fn()}
        onCloseCashSession={vi.fn()}
        onOpenMovement={vi.fn()}
        onRegisterAssignmentChange={vi.fn()}
      />
      <SalesShortcutStrip itemsLocked={locked} />
    </>
  );
}

describe.each([
  {
    locale: 'en',
    search: 'Search',
    items: '2 items · 2 lines',
    obsolete: /Quick suggestion|Waiting…|when wired|reuses the existing|Last scanned/,
  },
  {
    locale: 'es',
    search: 'Buscar',
    items: '2 artículos · 2 líneas',
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
    const stripKeys = Array.from(
      screen.getByTestId('checkout-shortcut-chips').querySelectorAll('kbd'),
      key => key.textContent
    );
    expect(stripKeys).toEqual(expect.arrayContaining(['F2', 'F1', 'Delete', 'Alt+N']));
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
    expect(keys).not.toEqual(expect.arrayContaining(['Delete']));
    expect(keys).not.toEqual(expect.arrayContaining(['F5']));
    expect(container.querySelector('.sales-scan-hint kbd')).toBeNull();
  });
});
