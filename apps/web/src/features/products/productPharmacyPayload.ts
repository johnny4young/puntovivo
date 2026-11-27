import type { ProductFormValues } from './ProductFormModal';

const nullableText = (value: string) => value.trim() || null;
const nullablePositiveInt = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : null;
};

/** Build the regulated profile only when a product actually enables it. */
export function buildProductPharmacyPayload(values: ProductFormValues['pharmacy']) {
  return {
    activeIngredient: nullableText(values.activeIngredient),
    genericName: nullableText(values.genericName),
    concentration: nullableText(values.concentration),
    dosageForm: nullableText(values.dosageForm),
    administrationRoute: nullableText(values.administrationRoute),
    presentation: nullableText(values.presentation),
    dosesPerPack: nullablePositiveInt(values.dosesPerPack),
    cumCode: nullableText(values.cumCode),
    manufacturer: nullableText(values.manufacturer),
    authorizationHolder: nullableText(values.authorizationHolder),
    sanitaryRegistration: nullableText(values.sanitaryRegistration),
    registrationExpiresAt: nullableText(values.registrationExpiresAt),
    classification: values.classification,
    storageConditions: nullableText(values.storageConditions),
    requiresColdChain: values.requiresColdChain,
  };
}
