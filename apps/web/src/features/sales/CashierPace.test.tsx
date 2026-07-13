/** ENG-209 — user-scoped preference and private pace strip. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import { CashierPacePreferenceToggle } from './CashierPacePreferenceToggle';
import { CashierPaceStrip } from './CashierPaceStrip';
import {
  getCashierPaceStorageKey,
  readCashierPacePreference,
  setCashierPacePreference,
  subscribeCashierPacePreference,
} from './cashierPacePreference';

describe('cashier pace preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults off and isolates the preference by tenant and user', () => {
    expect(readCashierPacePreference('tenant-a:user-a')).toBe(false);
    setCashierPacePreference('tenant-a:user-a', true);
    expect(readCashierPacePreference('tenant-a:user-a')).toBe(true);
    expect(readCashierPacePreference('tenant-a:user-b')).toBe(false);
    expect(readCashierPacePreference('tenant-b:user-a')).toBe(false);
  });

  it('notifies only the matching owner subscription', () => {
    const matching = vi.fn();
    const other = vi.fn();
    const unsubscribeMatching = subscribeCashierPacePreference('tenant-a:user-a', matching);
    const unsubscribeOther = subscribeCashierPacePreference('tenant-a:user-b', other);

    setCashierPacePreference('tenant-a:user-a', true);
    expect(matching).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();

    unsubscribeMatching();
    unsubscribeOther();
  });

  it('resets an open window when another window clears local storage', () => {
    const ownerKey = 'tenant-a:user-a';
    setCashierPacePreference(ownerKey, true);
    const matching = vi.fn();
    const unsubscribe = subscribeCashierPacePreference(ownerKey, matching);

    window.localStorage.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: null }));

    expect(matching).toHaveBeenCalledOnce();
    expect(readCashierPacePreference(ownerKey)).toBe(false);
    unsubscribe();
  });

  it('toggles from the user menu and persists the opt-in', () => {
    const ownerKey = 'tenant-a:user-a';
    render(<CashierPacePreferenceToggle ownerKey={ownerKey} />);
    const toggle = screen.getByTestId('cashier-pace-preference-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(getCashierPaceStorageKey(ownerKey))).toBe('true');
  });

  it('keeps the in-memory opt-in when storage writes are blocked', () => {
    const ownerKey = 'tenant-a:write-blocked-user';
    const write = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage blocked', 'SecurityError');
      });

    render(<CashierPacePreferenceToggle ownerKey={ownerKey} />);
    const toggle = screen.getByTestId('cashier-pace-preference-toggle');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(readCashierPacePreference(ownerKey)).toBe(true);
    write.mockRestore();
  });
});

describe('CashierPaceStrip', () => {
  it('renders the aggregate-only pace and privacy signal', () => {
    render(
      <CashierPaceStrip
        pace={{
          sessionId: 'session-1',
          completedSales: 2,
          itemCount: 5,
          itemsPerMinute: 0.5,
          averageCheckoutSeconds: 300,
          personalBestItemsPerMinute: 2,
        }}
      />
    );

    expect(screen.getByTestId('cashier-pace-strip')).toHaveAccessibleName(/Mi ritmo|My pace/i);
    expect(screen.getByText(/Solo tú|Only you/i)).toBeInTheDocument();
    expect(screen.getByText(/5 min/i)).toBeInTheDocument();
    expect(screen.getByText(/0[,.]5/)).toBeInTheDocument();
    expect(screen.getByText(/2[,.]0/)).toBeInTheDocument();
  });
});
