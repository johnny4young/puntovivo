// Test-only instrumentation; not a product patch or a latency gate.
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
let hits = 0;
await build({
  root: resolve('apps/web'),
  mode: 'production',
  plugins: [
    {
      name: 'lab-catalog-closed-form-counter',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/features/products/ProductFormModal.tsx')) return;
        const marker = '}: ProductFormModalProps) {';
        if (!source.includes(marker)) throw Error('Product form instrumentation anchor missing');
        hits++;
        return source.replace(
          marker,
          marker +
            `\n  globalThis.__labCatalogNavigation?.formCalls.push({ open: isOpen, phase: globalThis.__labCatalogNavigation.phase });\n`
        );
      },
    },
  ],
  build: { manifest: true },
});
if (hits !== 1) throw Error('Expected exactly one instrumented module');
const { generateCompanionServiceWorker } = await import('./generate-companion-service-worker.mjs');
await generateCompanionServiceWorker(resolve('apps/web/dist'));
if (process.env.LAB_NAV_BUILD_RECORD)
  writeFileSync(
    process.env.LAB_NAV_BUILD_RECORD,
    JSON.stringify({ instrumentedModules: hits, productionReact: true, injectsOnlyCounter: true }) +
      '\n'
  );
