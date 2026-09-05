import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  const deferred = () => {
    let resolve = () => {};
    const promise = new Promise<void>(done => {
      resolve = done;
    });
    return { promise, resolve };
  };
  return {
    loadNamespaces: vi.fn<() => Promise<void>>(),
    moduleReady: deferred(),
    deferred,
    page: () => null,
  };
});
vi.mock('@/i18n', () => ({ default: { loadNamespaces: state.loadNamespaces } }));
vi.mock('./SalesPage', async () => {
  await state.moduleReady.promise;
  return { SalesPage: state.page };
});
import { loadSalesPage, SALES_INITIAL_NAMESPACES } from './salesPageLoader';
const callsAtImport = state.loadNamespaces.mock.calls.length;

describe('sales route loading', () => {
  beforeEach(() => {
    state.loadNamespaces.mockReset();
    state.loadNamespaces.mockResolvedValue();
  });

  it('does not preload feature translations merely by importing the route registry dependency', () => {
    expect(callsAtImport).toBe(0);
  });

  it('starts every initial namespace before the page module resolves without waiting for them', async () => {
    const namespaces = state.deferred();
    state.loadNamespaces.mockReturnValue(namespaces.promise);
    const page = loadSalesPage();
    expect(state.loadNamespaces).toHaveBeenCalledExactlyOnceWith([...SALES_INITIAL_NAMESPACES]);
    expect(SALES_INITIAL_NAMESPACES).toEqual([
      'sales',
      'returnErrors',
      'fulfillmentErrors',
      'promotions',
      'customers',
      'quotationPayablesErrors',
      'restaurants',
      'scannerErrors',
      'salesOperation',
      'salesQuickAccess',
      'receiptShare',
    ]);
    state.moduleReady.resolve();
    await expect(page).resolves.toEqual({ default: state.page });
    namespaces.resolve();
  });

  it('does not turn a rejected namespace preload into a rejected lazy page or unhandled rejection', async () => {
    state.loadNamespaces.mockRejectedValue(new Error('namespace chunk unavailable'));
    await expect(loadSalesPage()).resolves.toEqual({ default: state.page });
    await Promise.resolve();
  });

  it('consults the live i18n instance on every invocation rather than caching language readiness', async () => {
    await loadSalesPage();
    await loadSalesPage();
    expect(state.loadNamespaces).toHaveBeenCalledTimes(2);
  });
});
