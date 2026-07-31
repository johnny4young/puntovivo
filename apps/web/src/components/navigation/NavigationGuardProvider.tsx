import type { ReactNode } from 'react';
import { NavigationGuardContext } from './NavigationGuardContext';
import type { NavigationGuardController } from './navigationGuardController';

export function NavigationGuardProvider({
  controller,
  children,
}: {
  controller: NavigationGuardController;
  children: ReactNode;
}) {
  return (
    <NavigationGuardContext.Provider value={controller}>{children}</NavigationGuardContext.Provider>
  );
}
