import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Site } from '@/types';
import { normalizeSites, useActiveSite } from './siteSelection';

vi.mock('./siteStorage', () => ({
  getStoredSiteId: vi.fn(),
  persistSiteId: vi.fn(),
  clearStoredSiteId: vi.fn(),
}));

import {
  clearStoredSiteId,
  getStoredSiteId,
  persistSiteId,
} from './siteStorage';

const mockedGet = vi.mocked(getStoredSiteId);
const mockedPersist = vi.mocked(persistSiteId);
const mockedClear = vi.mocked(clearStoredSiteId);

function makeSite(overrides: Partial<Site> = {}): Site {
  return {
    id: overrides.id ?? 'site-1',
    tenantId: overrides.tenantId ?? 'tenant-1',
    companyId: 'company-1',
    name: overrides.name ?? 'Site',
    address: null,
    phone: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Site;
}

beforeEach(() => {
  mockedGet.mockReturnValue(null);
  mockedPersist.mockClear();
  mockedClear.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('normalizeSites', () => {
  it('returns an empty array for undefined input', () => {
    expect(normalizeSites(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeSites([])).toEqual([]);
  });

  it('coerces missing isActive to false (preserves the rest of the row)', () => {
    const site = makeSite({ id: 'a' });
    const partial = { ...site, isActive: undefined } as unknown as Site;
    const out = normalizeSites([partial]);
    expect(out).toHaveLength(1);
    expect(out[0]?.isActive).toBe(false);
    expect(out[0]?.id).toBe('a');
  });

  it('preserves explicit isActive flags (true and false)', () => {
    const out = normalizeSites([
      makeSite({ id: 'a', isActive: true }),
      makeSite({ id: 'b', isActive: false }),
    ]);
    expect(out.map(s => [s.id, s.isActive])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});

describe('useActiveSite — resolution', () => {
  it('returns null when tenantId is missing', () => {
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: null,
        sites: [makeSite()],
        fallbackSiteId: 'site-1',
      })
    );
    expect(result.current.currentSite).toBeNull();
    expect(result.current.currentSiteId).toBeNull();
  });

  it('returns null when the sites list is empty', () => {
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites: [],
        fallbackSiteId: 'site-anything',
      })
    );
    expect(result.current.currentSite).toBeNull();
    expect(result.current.currentSiteId).toBeNull();
  });

  it('prefers the stored site id when it exists in the sites list', () => {
    mockedGet.mockReturnValue('site-2');
    const sites = [
      makeSite({ id: 'site-1' }),
      makeSite({ id: 'site-2', name: 'Other' }),
    ];
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites,
        fallbackSiteId: 'site-1',
      })
    );
    expect(result.current.currentSiteId).toBe('site-2');
    expect(result.current.currentSite?.name).toBe('Other');
  });

  it('falls back to fallbackSiteId when the stored id is unknown', () => {
    mockedGet.mockReturnValue('site-deleted');
    const sites = [makeSite({ id: 'site-1' })];
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites,
        fallbackSiteId: 'site-1',
      })
    );
    expect(result.current.currentSiteId).toBe('site-1');
  });

  it('returns null when no candidate (current/stored/fallback) matches', () => {
    mockedGet.mockReturnValue(null);
    const sites = [makeSite({ id: 'site-1' })];
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites,
        fallbackSiteId: 'unknown-site',
      })
    );
    expect(result.current.currentSiteId).toBeNull();
    // When resolution returns null, the storage entry is cleared (effect path).
    expect(mockedClear).toHaveBeenCalledWith('tenant-1');
  });
});

describe('useActiveSite — persistence side-effects', () => {
  it('persists the resolved site id whenever it changes', async () => {
    const sites = [makeSite({ id: 'site-1' })];
    renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites,
        fallbackSiteId: 'site-1',
      })
    );
    await waitFor(() => {
      expect(mockedPersist).toHaveBeenCalledWith('site-1', 'tenant-1');
    });
    expect(mockedClear).not.toHaveBeenCalled();
  });

  it('does not write storage when tenantId is null', () => {
    renderHook(() =>
      useActiveSite({
        tenantId: null,
        sites: [makeSite()],
        fallbackSiteId: 'site-1',
      })
    );
    expect(mockedPersist).not.toHaveBeenCalled();
    expect(mockedClear).not.toHaveBeenCalled();
  });
});

describe('useActiveSite — switchSite', () => {
  it('switches to a known site (and persists)', async () => {
    const sites = [
      makeSite({ id: 'site-1' }),
      makeSite({ id: 'site-2' }),
    ];
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites,
        fallbackSiteId: 'site-1',
      })
    );
    await waitFor(() => {
      expect(result.current.currentSiteId).toBe('site-1');
    });
    await act(async () => {
      await result.current.switchSite('site-2');
    });
    await waitFor(() => {
      expect(result.current.currentSiteId).toBe('site-2');
    });
    expect(mockedPersist).toHaveBeenLastCalledWith('site-2', 'tenant-1');
  });

  it('is a no-op when the target site is unknown', async () => {
    const sites = [makeSite({ id: 'site-1' })];
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: 'tenant-1',
        sites,
        fallbackSiteId: 'site-1',
      })
    );
    await waitFor(() => {
      expect(result.current.currentSiteId).toBe('site-1');
    });
    await act(async () => {
      await result.current.switchSite('does-not-exist');
    });
    expect(result.current.currentSiteId).toBe('site-1');
  });

  it('is a no-op when tenantId is null', async () => {
    const { result } = renderHook(() =>
      useActiveSite({
        tenantId: null,
        sites: [makeSite()],
        fallbackSiteId: 'site-1',
      })
    );
    await act(async () => {
      await result.current.switchSite('site-1');
    });
    expect(result.current.currentSiteId).toBeNull();
  });
});
