/**
 * Real `/m` home page (Mobile Waiter).
 *
 * Replaces the `MobileWaiterHomePlaceholder` from . Mounts the
 * shared `VoiceOrderingScreen` with the phone-width stacked variant.
 *
 * @module features/restaurants/MobileWaiterHome
 */
import { VoiceOrderingScreen } from './VoiceOrderingScreen';

export default function MobileWaiterHome() {
  return <VoiceOrderingScreen variant="mobile" />;
}
