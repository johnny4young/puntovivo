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
});
