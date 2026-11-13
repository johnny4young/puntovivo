/** Remembers when the renderer last completed a sale, from the API responses main already sees. */
const SALE_PATHS = ['sales.create', 'sales.completeDraft'];

export function createSaleActivityTracker(now: () => number = Date.now) {
  let lastSaleAt: number | null = null;
  return {
    observe(method: string, url: string, statusCode: number): void {
      if (method !== 'POST' || statusCode >= 400) return;
      const path = url.split('?', 1)[0] ?? '';
      // tRPC batches join procedure names with commas.
      const procedures = path.slice(path.lastIndexOf('/') + 1).split(',');
      if (procedures.some(name => SALE_PATHS.includes(name))) lastSaleAt = now();
    },
    lastSaleAt: (): number | null => lastSaleAt,
  };
}
