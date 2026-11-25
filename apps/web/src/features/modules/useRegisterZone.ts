import {
  registerZoneDescriptor,
  resolveRegisterZone,
  type RegisterZoneId,
} from '@puntovivo/shared/register-zones';
import { useContext } from 'react';
import { AuthContext } from '@/features/auth/AuthContext';
import { useIsOptionalModuleActive } from './ModulesContext';

/**
 * Whether a register zone renders: profile default, admin override and module gate.
 * Without a session every zone stays on, as the register was before profiles.
 */
export function useRegisterZone(id: RegisterZoneId): boolean {
  const settings = useContext(AuthContext)?.tenant?.settings;
  const moduleActive = useIsOptionalModuleActive(registerZoneDescriptor(id).requiresModule);
  return moduleActive && resolveRegisterZone(settings?.businessType, settings?.registerZones, id);
}
