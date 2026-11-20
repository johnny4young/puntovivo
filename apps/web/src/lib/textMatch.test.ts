import { describe, expect, it } from 'vitest';
import { filterByQuery, normalizeForMatch } from './textMatch';

describe('filterByQuery', () => {
  const labels = ['Devolución', 'Suspender venta', 'Nueva venta', 'Abrir cajón'];

  it('matches without accents or case', () => {
    expect(filterByQuery(labels, 'devolucion', label => label)).toEqual(['Devolución']);
    expect(filterByQuery(labels, 'CAJON', label => label)).toEqual(['Abrir cajón']);
  });

  it('requires every word', () => {
    expect(filterByQuery(labels, 'venta nue', label => label)).toEqual(['Nueva venta']);
  });

  it('returns everything for an empty query', () => {
    expect(filterByQuery(labels, '  ', label => label)).toEqual(labels);
  });

  it('normalizes accents', () => {
    expect(normalizeForMatch('  Acción ')).toBe('accion');
  });
});
