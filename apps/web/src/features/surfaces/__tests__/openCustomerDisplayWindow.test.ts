import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetCustomerDisplayWindowForTests,
  openCustomerDisplayWindow,
} from '../openCustomerDisplayWindow';

const ACCESS_ID = '11111111-1111-4111-8111-111111111111';

function windowHandle() {
  return {
    closed: false,
    opener: window,
    location: { replace: vi.fn() },
    focus: vi.fn(),
    close: vi.fn(),
  } as unknown as Window;
}

beforeEach(() => {
  vi.restoreAllMocks();
  __resetCustomerDisplayWindowForTests();
});

describe('openCustomerDisplayWindow', () => {
  it('severs the opener before navigating and reuses the live handle', () => {
    const display = windowHandle();
    const open = vi.spyOn(window, 'open').mockReturnValue(display);

    expect(openCustomerDisplayWindow(ACCESS_ID)).toBe(true);
    expect(open).toHaveBeenCalledWith('', 'puntovivo-customer-display', 'popup');
    expect(display.opener).toBeNull();
    expect(display.location.replace).toHaveBeenCalledWith(`/customer-display?access=${ACCESS_ID}`);

    expect(openCustomerDisplayWindow(ACCESS_ID)).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(display.focus).toHaveBeenCalledTimes(2);
  });

  it('repairs the existing display to a new pairing without opening a duplicate', () => {
    const display = windowHandle();
    const open = vi.spyOn(window, 'open').mockReturnValue(display);
    const nextAccessId = '22222222-2222-4222-8222-222222222222';

    expect(openCustomerDisplayWindow(ACCESS_ID)).toBe(true);
    expect(openCustomerDisplayWindow(nextAccessId)).toBe(true);

    expect(open).toHaveBeenCalledOnce();
    expect(display.location.replace).toHaveBeenLastCalledWith(
      `/customer-display?access=${nextAccessId}`
    );
  });

  it('reports a blocked popup without treating it as success', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openCustomerDisplayWindow(ACCESS_ID)).toBe(false);
  });

  it('rejects an invalid pairing before asking the browser to open a window', () => {
    const open = vi.spyOn(window, 'open');
    expect(openCustomerDisplayWindow('tenant-1')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('closes a partially created window and permits a clean retry', () => {
    const broken = windowHandle();
    vi.mocked(broken.location.replace).mockImplementation(() => {
      throw new Error('navigation blocked');
    });
    const recovered = windowHandle();
    vi.spyOn(window, 'open').mockReturnValueOnce(broken).mockReturnValueOnce(recovered);

    expect(openCustomerDisplayWindow(ACCESS_ID)).toBe(false);
    expect(broken.close).toHaveBeenCalledOnce();
    expect(openCustomerDisplayWindow(ACCESS_ID)).toBe(true);
  });
});
