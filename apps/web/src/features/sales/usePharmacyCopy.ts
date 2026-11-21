import { useTranslation } from 'react-i18next';

/** The copy lives in a lazy namespace; pharmacy pieces render once it is loaded. */
export function usePharmacyCopy() {
  return useTranslation('pharmacyRegister', { useSuspense: false });
}
