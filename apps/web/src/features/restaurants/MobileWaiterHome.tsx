/**
 * ENG-039a — Real `/m` home page (Mobile Waiter).
 *
 * Replaces the `MobileWaiterHomePlaceholder` from ENG-069. Mounts the
 * shared `VoiceOrderingScreen` with the phone-width stacked variant.
 *
 * @module features/restaurants/MobileWaiterHome
 */
import { VoiceOrderingScreen } from './VoiceOrderingScreen';

export default function MobileWaiterHome() {
  return <VoiceOrderingScreen variant="mobile" />;
}
