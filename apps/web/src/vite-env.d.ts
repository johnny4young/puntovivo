/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /**
   * Web Vitals RUM sampling rate in [0, 1]. Overrides the default
   * (0.1 in production, 1.0 in dev). Leave unset to use the default.
   */
  readonly VITE_WEB_VITALS_SAMPLE_RATE?: string;
  /**
   * Sentry / GlitchTip DSN for the renderer error pipe. When set,
   * `installRenderTelemetryAdapter()` lazy-loads the browser SDK and registers
   * the render telemetry sink. Leave unset (the default) to ship zero SDK
   * code and emit zero telemetry traffic.
   */
  readonly VITE_PUNTOVIVO_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
