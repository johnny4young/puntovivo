import { describe, expect, it } from 'vitest';
import { createMockProduct } from '@/test/utils';
import { normalizeProductProviderSelections, normalizeProductProviders } from './providerState';

describe('providerState', () => {
  it('prefers the primary provider and removes duplicate provider assignments', () => {
    const result = normalizeProductProviders({
      providerId: 'provider-1',
      providerAssignments: [
        { providerId: 'provider-1' },
        { providerId: 'provider-2' },
        { providerId: 'provider-2' },
      ],
    });

    expect(result.primaryProviderId).toBe('provider-1');
    expect(result.providerAssignments).toEqual([
      { providerId: 'provider-1' },
      { providerId: 'provider-2' },
    ]);
  });

  it('maps a product into a stable provider selection model', () => {
    const product = createMockProduct({
      providerId: 'provider-3',
      providerAssignments: [
        { id: 'assignment-1', providerId: 'provider-4' },
        { id: 'assignment-2', providerId: 'provider-3' },
      ],
    });

    const result = normalizeProductProviderSelections(product);

    expect(result.primaryProviderId).toBe('provider-3');
    expect(result.providerAssignments).toEqual([
      { providerId: 'provider-3' },
      { providerId: 'provider-4' },
    ]);
  });

  it('returns the empty selection when no product is provided', () => {
    expect(normalizeProductProviderSelections(null)).toEqual({
      primaryProviderId: null,
      providerAssignments: [],
    });
  });

  it('handles a product with no providerId and no assignments', () => {
    const product = createMockProduct({
      providerId: null,
      providerAssignments: undefined,
    });
    expect(normalizeProductProviderSelections(product)).toEqual({
      primaryProviderId: null,
      providerAssignments: [],
    });
  });

  it('handles missing providerAssignments by treating it as an empty array', () => {
    expect(
      normalizeProductProviders({
        providerId: 'provider-1',
        providerAssignments: null,
      })
    ).toEqual({
      primaryProviderId: 'provider-1',
      providerAssignments: [{ providerId: 'provider-1' }],
    });
  });

  it('returns null primary when neither providerId nor assignments are supplied', () => {
    expect(normalizeProductProviders({})).toEqual({
      primaryProviderId: null,
      providerAssignments: [],
    });
  });

  it('drops empty providerId values from assignment list', () => {
    const result = normalizeProductProviders({
      providerAssignments: [
        { providerId: 'provider-1' },
        { providerId: '' },
        { providerId: 'provider-2' },
      ],
    });
    expect(result.primaryProviderId).toBe('provider-1');
    expect(result.providerAssignments).toEqual([
      { providerId: 'provider-1' },
      { providerId: 'provider-2' },
    ]);
  });
});
