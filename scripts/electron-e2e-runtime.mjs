export const ELECTRON_E2E_API_HOST = '127.0.0.1';
export const DEFAULT_ELECTRON_E2E_API_PORT = 18091;

export function resolveElectronE2eApiPort(env = process.env) {
  const raw = env.PUNTOVIVO_E2E_API_PORT?.trim();
  if (!raw) return DEFAULT_ELECTRON_E2E_API_PORT;

  const port = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PUNTOVIVO_E2E_API_PORT must be an integer from 1 to 65535');
  }
  return port;
}

export const ELECTRON_E2E_API_PORT = resolveElectronE2eApiPort();
export const ELECTRON_E2E_API_URL = `http://${ELECTRON_E2E_API_HOST}:${ELECTRON_E2E_API_PORT}`;
