# Regresión del lifecycle del editor cerrado de catálogo

**Idioma:** Español · [English](../../qa/CATALOG-EDITOR-LIFECYCLE.md)

## Objetivo y alcance

ProductsPage montaba ProductFormModal con snapshot listo incluso en `editingProduct=null, isOpen=false`. El modal oculta su DOM después de ejecutar hooks y solicitar el namespace diferido productQuickCreate. La condición nueva exige isModalOpen, conservando snapshot completo, key y callbacks. La key ya reinicia el formulario en cada apertura; mantenerlo cerrado no era un contrato de conservar borradores.

Sin cambios de memoización, consultas/TTL, autenticación, fiscalidad, redondeo o servidor. El módulo sigue importado estáticamente: se difiere el lifecycle, no todo el código. Se apila sobre #351 `02161ea 343a 6ef 6997043f 7de 9e 0856517e 59f 5c` para reutilizar fixtures/guardas saneados sin duplicarlos; #351 no cambia. Main verificado `404b 5d 7294ea 021a 5863d 2149c 79bf 483a 498b 73`, app 1.15.3. Revisa remotos antes de componer.

## Regresión rápida y gates

Node 24.21.0, pnpm 11.7.0, lockfile congelado. En un clon propio:

```sh
corepack pnpm --filter @puntovivo/shared run build
corepack pnpm --filter @puntovivo/web exec vitest run src/features/products/ProductsPage.details.test.tsx src/features/products/ProductsPage.moduleGate.test.tsx src/features/products/ProductFormModal.test.tsx src/features/products/providerState.test.ts src/features/categories/categoryTree.test.ts --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run build
```

La selección existente pasó 54/54; con el oráculo nuevo falló por una llamada al formulario cerrado (54 PASS/1 FAIL). Con la condición pasó 55/55, sin relajar aserciones. Usa tabla/drawer reales y observa el formulario pesado mediante el spy existente. Conserva tests de carga/snapshot, gates de módulos, cancelación, proveedores y categorías. No equivale a ci:web.

Calificación ampliada: cobertura con floors originales (`corepack pnpm --filter @puntovivo/web exec vitest run --coverage --maxWorkers=2`), fast lint, tipos, ESLint y build en composición privada de reparaciones. ci:web además requiere audit, otros contratos y Lighthouse; no se declara completo. No audits rojos idénticos, allowlists, Lighthouse canónico/native, merges ni despliegues.

## Medición aislada

Clon independiente sin .env/local.db y fixture E 2E sintético existente con identidades ya creadas. La preparación de #351 exige origen sintético, WAL quiescente, no sobreescritura y fiscal deshabilitado; no crea cuentas. No uses DB de aplicación. Dataset:32 cuentas,6 productos,24 categorías/proveedores/ubicaciones y 32 unidades con seeds. No se publican DB, auth states ni trazas. Usa lock compartido, entorno explícito limpio y HOME/TMPDIR/cachés propios.

```sh
corepack pnpm --filter @puntovivo/server run build
LAB_FRESHNESS_ACK_SYNTHETIC=1 LAB_FRESHNESS_FIXTURE_DB=/tmp/owned-e 2e-source/local.db node scripts/prepare-catalog-freshness.mjs
VITE_API_URL=http://127.0.0.1:18926 node scripts/lab-catalog-navigation-build.mjs
NODE_OPTIONS="--require=$PWD/e 2e/web/support/catalog-freshness-network.cjs" \
 PUNTOVIVO_E 2E_API_ORIGIN=http://127.0.0.1:18926 \
 LAB_BROWSER_OUTPUT=/tmp/owned-nav/browser LAB_BROWSER_JSON=/tmp/owned-nav/results.json \
 LAB_NAV_RESULTS=/tmp/owned-nav/samples.jsonl LAB_NAV_EXPECT_CLOSED=zero \
 corepack pnpm exec playwright test --config playwright.catalog-navigation.config.ts --project chromium
```

Crea antes el directorio de salida; configura PLAYWRIGHT_BROWSERS_PATH si necesitas caché de Chromium revisada. Verifica API 18926/UI 5173 libres, sin prestar ni matar listeners. La configuración arranca backend loopback seedData:false y preview de producción, un worker/cero retries. Guardas Node/navegador rechazan red externa. Sin native, impresora ni proveedor real; cookies/orígenes estrictos se conservan y no se debilita seguridad.

El build usa la configuración Vite normal con un contador test-only al entrar a ProductFormModal y generación normal del service worker Companion. Exige instrumentar exactamente un módulo; el build estándar no lo incluye. El probe exige observar llamadas con editor abierto para evitar falsos ceros sin instrumentación. Cuenta invocaciones de la función, incluidos posibles reintentos/suspensiones; no commits React ni tiempo CPU.

Cada muestra usa contexto nuevo con manager existente: Dashboard autenticado estable→Products mediante enlace real→Dashboard→Products caliente. El shell común ya está cargado; no mide arranque del navegador. Valida SKU/categoría, products.list 1 frío/0 caliente, detalle, selección de edición, conservar/descartar borrador, fila intacta y crear/cancelar limpio. No envía mutaciones de producto. El routing desactiva caché HTTP; módulos y QueryClient sí se reutilizan. Mantén ese contrato en ambos lados.

Click capture y MutationObserver con siguiente animation frame miden fila visible; networkidle más dos frames delimita conteos. Cinco muestras secuenciales antes y después, sin aleatorización ABBA. Host/V 8/cachés/automatización limitan la comparación. Conserva outliers y hashes de fuente/lock/fixture. lab-catalog-state.mjs registra hash/conteos del catálogo e invariantes fiscales, sin filas/credenciales; compara antes/después.

## Evidencia y límites

| Métrica,5 muestras                         | Antes                 | Después                |
| ------------------------------------------ | --------------------- | ---------------------- |
| Invocaciones cerradas frías                | 4,4,4,4,4             | 0,0,0,0,0              |
| Invocaciones cerradas calientes            | 2,2,2,2,2             | 0,0,0,0,0              |
| Fila fría ms:mediana;rango;SD muestral     | 87.1;85.2–152.9;29.23 | 80.9;80.1–349.4;120.10 |
| Fila caliente ms:mediana;rango;SD muestral | 29.0;26.4–30.6;1.66   | 30.4;21.6–30.7;3.93    |
| Recursos JS fríos/bytes encoded            | 27/61243              | 26/60262               |
| JS caliente;procedimientos products.list   | 0;0                   | 0;0                    |
| Muestras funcionales;pageerrors            | 5 PASS;0              | 5 PASS;0               |

El recurso ausente es productQuickCreate en inglés,972 bytes; los 9 bytes restantes son detalles del output. No se afirma mejora general de bundle. El namespace sigue disponible al abrir el editor. Catálogo hash `331fa 1e 943c 60faf 99249f 5a 97114f 0f 413a 507d 9bbc 90dc 2c 394dbd 33e 0e 126`,32 usuarios y 0 documentos/outbox/flags fiscales. Fixture origen `d 4adb 6658e 7cf 19590b 1d 72a 881af 7c 6469696d 47b 07cf 5a 002603de 54957159`.

Se sostiene la eliminación de trabajo cerrado y una petición innecesaria en este flujo. Latencia inconclusa: se conserva el outlier 349.4ms y rangos superpuestos. Sin afirmaciones de p 95, CPU/memoria, guardado, UI española o producción. No se repite N+1. Lazy loading completo sería otra hipótesis con oráculos de foco/fallback; no se inicia aquí ni se extrae la abstracción de 16 campos.
