import { useMediaQuery } from '@/hooks/useMediaQuery';

/** True where the selling screen uses its phone layout (the CSS `max-width: 767px` block). */
export function usePhoneLayout(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
