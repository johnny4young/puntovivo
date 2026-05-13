/**
 * ENG-039a — Real `/touch` home page.
 *
 * Replaces the `TouchHomePlaceholder` from ENG-069. Mounts the shared
 * `VoiceOrderingScreen` with the tablet two-column variant.
 *
 * @module features/restaurants/TouchHome
 */
import { VoiceOrderingScreen } from './VoiceOrderingScreen';

export default function TouchHome() {
  return <VoiceOrderingScreen variant="touch" />;
}
