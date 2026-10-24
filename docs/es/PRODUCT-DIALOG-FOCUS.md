# Identidad del control que abre el diálogo de producto

**Idioma:** Español · [English](../PRODUCT-DIALOG-FOCUS.md)

## Objetivo y causa

En app1.15.3/main404b5d7294ea021a5863d2149c79bf483a498b73, abrir la confirmación de desactivación remonta el botón Eliminar. ProductsPage crea columnas en cada render; el renderer inline de acciones cambia de tipo React en flexRender. El opener capturado ya está desconectado al abrir y cancelar deja el foco en BODY. También ocurre antes de #348; su reparación del portal de avisos no resuelve la identidad de fila.

El renderer de acciones tiene ahora un tipo estable de módulo y lee callbacks, permisos y datos actuales desde la definición de columna. Productos usa IDs de entidad para filas, celdas, selección y keys virtuales; las demás tablas conservan sus índices. Reordenar mantiene el control del mismo producto. No se memorizan closures con callbacks antiguos.

El cierre normal devuelve el foco al mismo opener conectado usando el hook existente. Solo si desapareció realmente por eliminación, filtrado o ventana virtual se usa el buscador de productos, o el título visible si la tabla y el buscador desaparecieron. El título tiene tabindex=-1 programático, fuera del recorrido normal. ConfirmModal propaga la opción existente de Modal. Se conservan inert global, el confinamiento de foco y el aislamiento del toast.

## Alcance y dependencias

Este PR se apila sobre #347 headcb3cfed99e999d93bc126b4ef33a7012737d1231 para conservar el manejo del rechazo; #347 queda intacto. La calificación real de error/reintento también requiere atomicidad #343 y accesibilidad #348 head0b5122d6eb393ee3d1a67d9b8ea358683bc4f76e. No cambia backend, redondeo, dependencias, lock, release ni comportamiento fiscal o nativo.

Orden de revisión:345 →341 →342 →340 junto344 →343 →346/347 →348 →esta reparación. El usuario decide los merges. 345 restaura notas factuales,341 corrige Vite,342 aporta la base Electron y340/344 cierran la composición de auditoría. Se deben separar CI público y resultado privado compuesto.

## Reproducción sintética

Node24.21.0 y pnpm11.7.0, checkout nuevo propio, sin credenciales heredadas, DB/perfil propios y lock pesado cooperativo. No reutilizar datos reales, puertos ocupados ni aplicaciones instaladas. Instalar con lock congelado, sin ignorar advisories para obtener verde.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/features/products/ProductsPage.focus.test.tsx src/features/products/productsColumns.identity.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run test:coverage -- --run
corepack pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
node scripts/check-documentation-translations.mjs
```

Para la composición completa usar el helper fijado de344, extensión346/347 y helper de348 documentados en esos PRs. Aplicar después este head con `python3 scripts/reproduce-product-focus.py NEW_COMPOSITION_DIRECTORY EXACT_FOCUS_HEAD`. El script exige el recibo con heads exactos y une los pares de traducción sin reemplazar el lock compuesto. No hace merge, instalación, pruebas ni push.

En esa composición construir servidor y ejecutar Chromium con un worker y cero retries:

```sh
corepack pnpm --filter @puntovivo/server run build
corepack pnpm exec playwright test --config playwright.web.config.ts --project chromium e2e/web/product-deactivation-error-accessibility.spec.ts e2e/web/product-dialog-opener-identity.spec.ts --workers=1
```

Revisar launcher/setup antes de ejecutar. El laboratorio usa clon nuevo, API local protegida y setup que prohíbe activar/emitir fiscal. El fixture existente de348 rechaza una escritura sintética de outbox, comprueba rollback y alert EN/ES accesible, cancela al opener original, reintenta y comprueba persistencia. Conserva todas sus aserciones. El nuevo fixture usa46 productos sintéticos: cancelar con mouse conserva el mismo nodo y cancelar con teclado después de una expulsión virtual real enfoca el buscador. Las pruebas de componente cubren EN/ES, teclado/mouse, error/reintento, reordenamiento, fila retirada, título tras error de consulta, callbacks/permisos actuales y selección por ID. Los traces crudos pueden contener credenciales efímeras y deben seguir privados.

Antes del parche fallan las ocho regresiones de página sobre la composición con348; después pasan. Los cuatro E2E rojos históricos de348 se conservan separados de resultados combinados nuevos. La descripción del PR contiene SHAs, conteos y CI público; draft no equivale a listo para merge. El árbol accesible de Chromium no certifica voz de lector nativo. No se ejecuta Lighthouse canónico ni flujo fiscal/nativo en esta reparación acotada.
