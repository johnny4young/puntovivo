interface QuitEvent {
  preventDefault(): void;
}

/** Drain writes once, then let Electron start a fresh native quit cycle. */
export function createGracefulQuitHandler(options: {
  shutdown: () => Promise<void>;
  quit: () => void;
  onError: (error: unknown) => void;
  defer?: (callback: () => void) => void;
}): (event: QuitEvent) => void {
  let complete = false;
  let pending = false;
  return event => {
    if (complete) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    void Promise.resolve()
      .then(options.shutdown)
      .catch(options.onError)
      .finally(() => {
        complete = true;
        // macOS can ignore a nested quit while its cancelled native termination
        // is still unwinding. A fresh event-loop turn resumes graceful exit;
        // this is not a timeout or a forced exit that could discard writes.
        (options.defer ?? setImmediate)(options.quit);
      });
  };
}
