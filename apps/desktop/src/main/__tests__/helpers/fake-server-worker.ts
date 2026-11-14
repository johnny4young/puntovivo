import {
  serializeError,
  type ChannelExit,
  type HostChannel,
  type HostTransport,
  type SupervisorMessage,
} from '@electron-stagewright/host-supervisor';
import type { WorkerStartOptions } from '../../server-host/contract.ts';

/** How one launched worker answers `start`. */
export type FakeStart =
  | { url: string; gate?: Promise<void>; urlGate?: Promise<void> }
  | { fail: Error; gate?: Promise<void> };

export interface FakeWorker {
  readonly payload: WorkerStartOptions | null;
  readonly stopped: boolean;
  /** Operations received, in order. */
  readonly calls: string[];
  /** Reports an uncaught error, then exits like the crash handler does. */
  crash(error: Error): void;
  /** Exits the way Node ends a worker past its heap limit. */
  outOfMemory(): void;
}

/** A transport whose workers speak the supervisor protocol without a thread. */
export function fakeServerWorkerTransport(plan: FakeStart[]) {
  const workers: FakeWorker[] = [];
  const transport: HostTransport = {
    launch(): HostChannel {
      const outcome = plan[workers.length];
      if (!outcome) throw new Error('unexpected launch');
      let toMain: ((message: unknown) => void) | null = null;
      let onExit: ((exit: ChannelExit) => void) | null = null;
      let alive = true;
      const post = (message: unknown) => setImmediate(() => alive && toMain?.(message));
      const exit = (value: ChannelExit) => {
        if (!alive) return;
        alive = false;
        setImmediate(() => onExit?.(value));
      };
      const worker = {
        payload: null as WorkerStartOptions | null,
        stopped: false,
        calls: [] as string[],
        crash(error: Error) {
          post({ type: 'crashed', error: serializeError(error) });
          setImmediate(() => exit({ code: 1 }));
        },
        outOfMemory() {
          const error = Object.assign(new Error('heap'), { code: 'ERR_WORKER_OUT_OF_MEMORY' });
          exit({ code: 1, error, outOfMemory: true });
        },
      };
      workers.push(worker);
      // Like serveHost, a stop waits for the calls already accepted.
      let inFlight: Promise<void> = Promise.resolve();
      const receive = async (message: SupervisorMessage) => {
        switch (message.type) {
          case 'start':
            worker.payload = message.payload as WorkerStartOptions;
            await outcome.gate;
            // A real worker stays up after a failed start; the supervisor retires it.
            post(
              'fail' in outcome
                ? { type: 'start-failed', error: serializeError(outcome.fail) }
                : { type: 'started' }
            );
            return;
          case 'call':
            worker.calls.push(message.op);
            if (message.op === 'getUrl' && 'url' in outcome && outcome.urlGate) {
              const answered = outcome.urlGate;
              inFlight = Promise.all([inFlight, answered]).then(() => undefined);
              await answered;
            }
            post({
              type: 'result',
              id: message.id,
              ok: true,
              value: message.op === 'getUrl' && 'url' in outcome ? outcome.url : null,
            });
            return;
          case 'stop':
            await inFlight;
            worker.stopped = true;
            post({ type: 'stopped' });
            setImmediate(() => exit({ code: 0 }));
            return;
          default:
            return;
        }
      };
      return {
        send: message => {
          if (!alive) throw new Error('The worker has exited');
          void receive(message);
        },
        onMessage: listener => {
          toMain = listener;
        },
        onExit: listener => {
          onExit = listener;
        },
        kill: () => exit({ code: 1 }),
      };
    },
  };
  return { transport, workers };
}

/** Resolves once `check` holds, polling between turns of the event loop. */
export async function until(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
