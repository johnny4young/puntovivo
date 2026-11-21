import { useTranslation } from 'react-i18next';

/** Units, list prices and job-site delivery copy lives in a lazy namespace. */
export function useHardwareCopy() {
  return useTranslation('hardwareRegister', { useSuspense: false });
}
