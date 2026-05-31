const LOCAL_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') {
      return true;
    }
    if (url.protocol === 'http:') {
      return LOCAL_HTTP_HOSTS.has(url.hostname);
    }
    return false;
  } catch {
    return false;
  }
}
