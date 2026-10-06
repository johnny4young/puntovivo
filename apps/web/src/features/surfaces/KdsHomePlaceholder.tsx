/**
 * KDS landing surface: mounts the real Kitchen Display board. `KdsShell`
 * provides the fullscreen black backdrop and `SurfaceShellRoute` the gating;
 * the body is the pending + ready card grid backed by `kds.list` + realtime SSE.
 */
import { KdsBoard } from '@/features/kds/KdsBoard';

export function KdsHomePlaceholder() {
  return <KdsBoard />;
}
