/**
 * ENG-185 — FiscalMaturityBadge tests.
 *
 * Pins the truth-guard contract: mock/draft packs render a visible
 * Demo/Draft chip, a certified pack renders nothing.
 */
import { render, screen } from '@/test/utils';
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { FiscalMaturityBadge } from './FiscalMaturityBadge';

describe('FiscalMaturityBadge (ENG-185)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders a Demo chip for a mock pack', () => {
    render(<FiscalMaturityBadge maturity="mock" />);
    expect(screen.getByTestId('fiscal-maturity-badge')).toHaveTextContent(/Demo/i);
  });

  it('renders a Draft chip for a draft pack', () => {
    render(<FiscalMaturityBadge maturity="draft" />);
    expect(screen.getByTestId('fiscal-maturity-badge')).toHaveTextContent(/Draft/i);
  });

  it('renders nothing for a certified pack (genuinely production-ready)', () => {
    const { container } = render(<FiscalMaturityBadge maturity="certified" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('fiscal-maturity-badge')).toBeNull();
  });

  it('localizes the draft label to Spanish (Borrador)', async () => {
    await i18n.changeLanguage('es');
    render(<FiscalMaturityBadge maturity="draft" />);
    expect(screen.getByTestId('fiscal-maturity-badge')).toHaveTextContent(
      /Borrador/i
    );
  });
});
