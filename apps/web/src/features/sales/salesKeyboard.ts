import type { SaleCartItem } from '@/features/sales/saleCart';

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

export function getActiveCartSelectionKey(
  items: SaleCartItem[],
  selectedItemKey: string | null
): string | null {
  if (selectedItemKey && items.some(item => item.key === selectedItemKey)) {
    return selectedItemKey;
  }

  return items[items.length - 1]?.key ?? null;
}
