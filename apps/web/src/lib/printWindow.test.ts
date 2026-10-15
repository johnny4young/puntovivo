import { afterEach, describe, expect, it, vi } from 'vitest';
import { openHtmlInPrintWindow } from './printWindow';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('isolated print popup', () => {
  it('detaches the opener before navigating and recognizes a successful popup', async () => {
    const calls: string[] = [];
    const popup = {
      set opener(value: unknown) {
        expect(value).toBeNull();
        calls.push('detach');
      },
      location: { replace: vi.fn(() => calls.push('navigate')) },
      close: vi.fn(),
    } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    let document: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => {
      document = value as Blob;
      return 'blob:print';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(
      openHtmlInPrintWindow('<html><head></head><body>receipt</body></html>', {
        features: 'noopener,noreferrer,width=420,height=720',
      })
    ).toBe(popup);
    expect(open).toHaveBeenCalledWith('', '_blank', 'width=420,height=720');
    expect(calls).toEqual(['detach', 'navigate']);
    expect(popup.location.replace).toHaveBeenCalledWith('blob:print');
    expect(await document!.text()).toContain('content="no-referrer"');
  });
  it('releases the document when opening really is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:blocked');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(openHtmlInPrintWindow('<p>receipt</p>')).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:blocked');
  });
  it('closes the blank window and revokes its document if safe navigation fails', () => {
    const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      location: {
        replace() {
          throw new Error('navigation failed');
        },
      },
      close,
    } as unknown as Window);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    expect(openHtmlInPrintWindow('<p>receipt</p>')).toBeNull();
    expect(close).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:failed');
  });
});
