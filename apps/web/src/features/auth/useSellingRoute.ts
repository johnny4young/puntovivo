import { useModulesSnapshot } from '@/features/modules';
import { useAuth } from './AuthProvider';
import { isTouchRegisterVerticalId } from '@puntovivo/shared/vertical-presets';
import { getSellingRouteForProfile } from './roleAccess';

/**
 * The register the tenant's business profile sells on. `isResolving` stays true
 * only for touch profiles while module state is still loading, so other
 * profiles never wait.
 */
export function useSellingRoute(): { route: '/sales' | '/touch'; isResolving: boolean } {
  const { tenant } = useAuth();
  const { modules, isPlaceholder, isError } = useModulesSnapshot();
  const businessType = tenant?.settings.businessType;
  const isResolving = isTouchRegisterVerticalId(businessType) && isPlaceholder && !isError;
  return {
    // Placeholder modules keep POS táctil off, so a cold cache resolves to Vender.
    route: getSellingRouteForProfile(businessType, modules['pos-touch']),
    isResolving,
  };
}
