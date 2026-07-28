/**
 * Credential banners are interactive local UX, not CI output. Tests and
 * quality-gate runners set the suppression flag so fixed development
 * credentials never leak into captured logs.
 */
export function shouldPrintCredentialBanner(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER !== 'true';
}
