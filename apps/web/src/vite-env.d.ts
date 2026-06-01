/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  /**
   * ENG-173 — Web Vitals RUM sampling rate in [0, 1]. Overrides the default
   * (0.1 in production, 1.0 in dev). Leave unset to use the default.
   */
  readonly VITE_WEB_VITALS_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
