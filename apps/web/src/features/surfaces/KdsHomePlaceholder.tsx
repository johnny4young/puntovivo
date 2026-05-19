/**
 * ENG-098 — KDS landing surface now mounts the real Kitchen Display
 * board. The placeholder shell built in ENG-069 still provides the
 * fullscreen black backdrop and route gating; the body inside is the
 * pending + ready card grid backed by `kds.list` + realtime SSE.
 */
import { KdsBoard } from '@/features/kds/KdsBoard';

export function KdsHomePlaceholder() {
  return <KdsBoard />;
}
