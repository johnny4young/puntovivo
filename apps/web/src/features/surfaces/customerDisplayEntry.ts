interface DisplayEntryLocation {
  pathname: string;
  hash: string;
}

function normalizePath(value: string): string {
  const path = value.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** Detect an independently loaded Customer Display document in web and packaged hash routing. */
export function isCustomerDisplayEntryLocation(location: DisplayEntryLocation): boolean {
  if (normalizePath(location.pathname) === '/customer-display') return true;
  const hashPath = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  return normalizePath(hashPath) === '/customer-display';
}
