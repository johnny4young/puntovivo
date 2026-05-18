/**
 * ENG-087 — `/touch` home page.
 *
 * V1 of the Touch POS surface (grid catálogo + cart sidebar +
 * Cobrar CTA). Replaces the prior `VoiceOrderingScreen` mount
 * from ENG-039a; voice ordering now lives at `/touch/voice` as a
 * sibling route registered in `App.tsx`, so existing voice users
 * keep access via direct URL.
 *
 * @module features/restaurants/TouchHome
 */
import { PosTouchScreen } from '@/features/pos-touch/PosTouchScreen';

export default function TouchHome() {
  return <PosTouchScreen />;
}
