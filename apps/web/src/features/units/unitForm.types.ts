import type { Unit, UnitDimension } from '@/types';

export interface UnitFormValues {
  name: string;
  abbreviation: string;
  dimension: UnitDimension | '';
  standardCode: string;
  isActive: boolean;
}

const defaultValues: UnitFormValues = {
  name: '',
  abbreviation: '',
  dimension: '',
  standardCode: '',
  isActive: true,
};

export function createUnitFormValues(unit: Unit | null): UnitFormValues {
  if (!unit) return defaultValues;

  return {
    name: unit.name,
    abbreviation: unit.abbreviation,
    dimension: unit.dimension ?? '',
    standardCode: unit.standardCode ?? '',
    isActive: unit.isActive,
  };
}

export function hasAdvancedUnitData(unit: Unit | null): boolean {
  if (!unit) return false;
  const values = createUnitFormValues(unit);
  return Boolean(values.dimension || values.standardCode || !values.isActive);
}
