/** Device-local scale selection: the port belongs to this computer, so it is never synchronized. */
import { createTenantPreferenceFile } from '../tenant-preference-file.ts';
import { isScaleConfig } from './protocol.ts';

export function createScalePreferences(directory: string) {
  return createTenantPreferenceFile(directory, 'scale', value =>
    isScaleConfig(value) ? value : null
  );
}
