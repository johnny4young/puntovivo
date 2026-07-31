import type { NavigationGuardController } from './navigationGuardController';

interface HistoryUpdate {
  action: string;
  delta: number | null;
}

interface HistoryLike<Update extends HistoryUpdate = HistoryUpdate> {
  readonly action: unknown;
  readonly location: unknown;
  createHref: (...args: never[]) => unknown;
  createURL: (...args: never[]) => unknown;
  encodeLocation: (...args: never[]) => unknown;
  push: (...args: never[]) => void;
  replace: (...args: never[]) => void;
  go: (delta: number) => void;
  listen: (listener: (update: Update) => void) => () => void;
}

/**
 * Adds a confirmation seam to React Router's own history implementation.
 * PUSH/REPLACE/imperative GO are delayed directly. Browser-initiated POP first
 * returns to the current entry, then exposes a continuation that can replay the
 * original delta after the operator confirms.
 */
export function createGuardedHistory<History extends HistoryLike>(
  history: History,
  controller: NavigationGuardController
): History {
  type Update = Parameters<Parameters<History['listen']>[0]>[0];
  let popState: 'idle' | 'restoring' | 'replaying' = 'idle';
  let pendingDelta: number | null = null;

  return {
    get action() {
      return history.action;
    },
    get location() {
      return history.location;
    },
    createHref: history.createHref.bind(history),
    createURL: history.createURL.bind(history),
    encodeLocation: history.encodeLocation.bind(history),
    push: ((...args: never[]) =>
      controller.request(() => history.push(...args))) as History['push'],
    replace: ((...args: never[]) =>
      controller.request(() => history.replace(...args))) as History['replace'],
    go(delta: number) {
      controller.request(() => history.go(delta));
    },
    listen(listener: (update: Update) => void) {
      return history.listen(update => {
        const delta = update.delta;

        if (popState === 'replaying') {
          popState = 'idle';
          listener(update as Update);
          return;
        }

        if (popState === 'restoring') {
          popState = 'idle';
          const replayDelta = pendingDelta;
          pendingDelta = null;
          if (replayDelta === null) return;
          controller.request(() => {
            popState = 'replaying';
            history.go(replayDelta);
          });
          return;
        }

        if (update.action !== 'POP' || !delta || !controller.isBlocked()) {
          listener(update as Update);
          return;
        }

        pendingDelta = delta;
        popState = 'restoring';
        history.go(-delta);
      });
    },
  } as History;
}
