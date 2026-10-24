# Foco durante una confirmación pendiente

**Idioma:** Español · [English](../CONFIRMATION-PENDING-FOCUS.md)

## Objetivo y causa

Con la identidad de fila y búsqueda de349, la composición alcanza7/8casos reales aprobados. El restante pierde foco en Confirmar durante la mutación, antes de cancelar. ConfirmModal aplica disabled nativo al botón enfocado mientras loading; deja de ser destino de teclado y puede perder foco. El timer normal de foco inicial del diálogo puede entonces elegir su primer control. Es independiente de la fila remontada de349 y del portal de348.

La acción pendiente conserva el mismo botón enfocable con aria-disabled y aria-busy. Un guard explícito de loading y confirmDisabled bloquea repeticiones de mouse/Enter/Espacio. La condición comercial confirmDisabled sigue usando disabled nativo; solo loading usa el estado ARIA protegido. No se fuerza foco, cambia timer/inert ni se suprimen errores. Sin cambios de API, esquema, dependencias o regla comercial. Cancelar conserva su comportamiento existente durante loading. El helper compartido de confirmación es el único cambio de producción.

## Reproducción y dependencias

Draft apilado en349 d83b4b68b89f5235ed0d181aa4505eabe0e496f9, preservando su head y7/8histórico. El flujo real necesita343rollback,347rechazo y348alert accesible, además del grafo auditado.

Orden de revisión/calificación:345 →341 →342 →340junto344 →343 →346/347 →348 →349 →esta reparación. El usuario decide merges reales; la receta no autoriza merge/deploy.

Node24.21.0, pnpm11.7.0 local, checkout e instalación congelada nuevos, datos sintéticos, entorno explícito limpio, HOME/TMP/cache/perfil/DB propios y lock pesado cooperativo. No reutilizar aplicación instalada, listener ajeno ni base real.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/components/form-controls/ConfirmModal.pending.test.tsx src/components/form-controls/Modal.test.tsx src/features/products/ProductsPage.focus.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run test:coverage -- --run
corepack pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
node scripts/check-documentation-translations.mjs
```

El fixture verifica Tab EN/ES mientras espera, repeticiones de teclado/mouse bloqueadas, mismo nodo al terminar loading y reintento. Las restricciones comerciales siguen impidiendo activar. Antes:2FAIL/1PASS. Se mantiene el gate estricto de consola.

`e2e/web/confirmation-pending-focus.spec.ts` retiene products.delete mediante un gate explícito. EN/ES teclado/mouse comprueban foco del botón original mientras espera, una sola petición, rechazo localizado accesible, rollback, Cancelar al opener original y reintento exitoso. Se conservan intactos los E2E anteriores348/349; ejecutar12casos:

```sh
corepack pnpm --filter @puntovivo/server run build
corepack pnpm exec playwright test --config playwright.web.config.ts --project chromium e2e/web/product-deactivation-error-accessibility.spec.ts e2e/web/product-dialog-opener-identity.spec.ts e2e/web/confirmation-pending-focus.spec.ts --workers=1
```

Usar receta344275d, extensión346/347, helper348 y script versionado349. Aplicar después este head con `scripts/reproduce-confirmation-focus.py NEW_RECIPE_DIRECTORY EXACT_CONFIRMATION_HEAD`. Verifica recibo, copia solo este diff y une pares, sin reemplazar lock ni instalar/probar/merge/push.

Revisar setup antes: el laboratorio usa clones nuevos, guardas loopback, sin reutilizar servidor y setup que prohíbe activar/emitir fiscal. Traces crudos pueden contener credenciales efímeras y permanecen privados. La descripción del PR fija heads, conteos, evidencia roja previa, CI y límites. No se certifican voz de lector nativo, Lighthouse canónico, fiscal ni Electron nativo. Draft no equivale a listo para merge/release.
