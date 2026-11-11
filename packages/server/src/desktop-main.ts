/**
 * Light entry for the Electron main thread. The desktop server runs in a
 * worker, so main must not load Fastify, tRPC, the services or the routers.
 * Crash capture still pulls in the Drizzle schema definitions.
 */
export { createModuleLogger, type PuntovivoLogger } from './logging/logger.js';
export { captureProcessCrash } from './observability/capture.js';
export { flushServerTelemetry, initServerTelemetryAdapter } from './observability/sentry.js';
export { resolveRuntimeConfig, type RuntimeConfig } from './config/runtime.js';
export { createSseParser, type ParsedSseEvent } from '@puntovivo/shared/realtime-sse';
export {
  EscPosTransportError,
  resolveTransport,
  type EscPosTransportConfig,
} from './services/peripherals/escpos/transport.js';
