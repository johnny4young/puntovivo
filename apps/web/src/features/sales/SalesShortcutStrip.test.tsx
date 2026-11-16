import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/utils';
import { SalesShortcutStrip } from './SalesShortcutStrip';

function keys() {
  const strip = screen.getByTestId('checkout-shortcut-chips');
  return Array.from(strip.querySelectorAll('kbd'), key => key.textContent);
}

describe('SalesShortcutStrip', () => {
  it('reads every key from the shortcut catalogue', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    render(<SalesShortcutStrip />);

    expect(keys()).toEqual(['F2', 'F1', 'Delete', 'Ctrl+R', 'Alt+N', 'Ctrl+K']);
    const strip = within(screen.getByTestId('checkout-shortcut-chips'));
    expect(strip.getByText('Shortest path:')).toBeInTheDocument();
    expect(strip.getByText('exact cash')).toBeInTheDocument();
    expect(strip.getByText('everything else')).toBeInTheDocument();
  });

  it('drops the line key on a locked ticket', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    render(<SalesShortcutStrip itemsLocked />);

    expect(keys()).not.toContain('Delete');
    expect(screen.queryByText('remove line')).not.toBeInTheDocument();
  });
});
