# Proyecciones de Productos después de editar metadatos

**Idioma:** Español · [English](../../qa/CATALOG-METADATA-FRESHNESS.md)

## Contrato y causa

En `404b5d7294ea021a5863d2149c79bf483a498b73` (app 1.15.3), AppRoot fija staleTime en 300000ms. Las ediciones de categoría/proveedor invalidan sus listas, pero products.list/getById también serializan sus nombres relacionados. Al volver a Productos con caché caliente, el detalle conserva el nombre anterior mientras el selector del editor muestra el nuevo. Una consulta vigente no se renueva normalmente al montar la vista.

La reparación invalida el router products después de cada edición exitosa de categoría/proveedor, incluidos filtros y detalle por ID. Conserva las invalidaciones originales y no afecta la caché de clientes, TTL, sondeo, servidor, versión ni redondeo.

Otra sesión no tiene contrato general de broadcast de metadatos: puede reutilizar datos vigentes. Foco/reconexión renuevan consultas caducadas. El probe adelanta Date con setFixedTime, conservando los temporizadores reales, y emite visibilitychange y offline/online en contextos headless propios. Valida esos manejadores; no certifica foco nativo, recuperación real de internet, service workers ni sincronización entre dispositivos.

Se eliminan opciones sintéticas sin referencias. Las FK de categoría/proveedor/unidad del fixture son restrictivas. No se redefine el borrado de registros utilizados. Unidad es control negativo en este editor porque sus opciones ya vienen de units.list invalidado; no se califican otros consumidores de unidad.

## Reproducción sin base de datos

Usa Node 24.21.0, pnpm 11.7.0 y el lockfile congelado:

```sh
corepack pnpm --filter @puntovivo/web exec vitest run src/features/categories/CatalogProductFreshness.test.tsx --maxWorkers=1
```

Los dos casos usan QueryClient real con cinco minutos de vigencia, listas con filtros y detalle calientes, y transporte simulado. Ejecutan el callback real de éxito de cada página. Sin las dos invalidaciones reciben Original name; con ellas reciben Renamed metadata. Clientes permanece vigente. Para el control rojo conserva el test y retira solo las dos invalidaciones nuevas en una copia desechable.

## Matriz de navegador

Usa un clon independiente nuevo, sin .env ni local.db, dependencias congeladas y scripts de instalación revisados. Compila shared/server. La fuente debe ser un fixture E2E sintético canónico existente, con admin/manager de E2E_USERS ya creados, WAL vacío, tablas fiscales vacías y DIAN deshabilitada. El probe no crea cuentas ni adjunta DB, credenciales, estado de autenticación, trazas ni rutas personales. La disponibilidad del fixture es requisito explícito; nunca uses una DB de aplicación.

prepare-catalog-freshness.mjs rechaza sobreescrituras y usuarios ajenos a @local.test o al seed admin@localhost. Copia dentro del clon, registra SHA256 de origen, crea seis productos y 24opciones por catálogo y verifica que no cambie la cantidad de cuentas. Los IDs/valores están en el script. Conserva las fuentes y evidencia de cada comparación.

```sh
corepack pnpm --filter @puntovivo/shared run build
corepack pnpm --filter @puntovivo/server run build
LAB_FRESHNESS_ACK_SYNTHETIC=1 LAB_FRESHNESS_FIXTURE_DB=/tmp/owned-synthetic-source/local.db node scripts/prepare-catalog-freshness.mjs
NODE_OPTIONS="--require=$PWD/e2e/web/support/catalog-freshness-network.cjs" \
 PUNTOVIVO_E2E_API_ORIGIN=http://127.0.0.1:18924 \
 LAB_BROWSER_OUTPUT=/tmp/owned-freshness/results \
 LAB_BROWSER_JSON=/tmp/owned-freshness/results.json \
 LAB_CATALOG_REQUEST_LOG=/tmp/owned-freshness/requests.jsonl \
 corepack pnpm exec playwright test --config playwright.catalog-freshness.config.ts --project chromium
```

Crea antes el directorio de salida y configura PLAYWRIGHT_BROWSERS_PATH si necesitas una caché existente. Usa entorno explícito limpio, HOME/TMPDIR/caché propios y sin credenciales heredadas. Adquiere lock pesado y lease cooperativo; verifica libres API 18924/UI 5173. La configuración rechaza servidores existentes y usa un worker, cero reintentos, seedData:false y solo loopback. Las guardas Node/navegador rechazan red externa. No se lanza app nativa ni impresora. Libera solo recursos propios. Cada matriz requiere clon/fixture nuevos; no repitas inserciones sobre la misma DB.

Cada caso local calienta Productos/detalle, edita mediante el índice de Catálogo, vuelve con enlaces SPA, lee detalle/selector, elimina una opción no utilizada y comprueba la selección conservada. Un segundo contexto manager lee mientras admin escribe. Foco a+60s conserva caché vigente; a+301s renueva. Reconexión a+330s conserva la eliminación aún vigente; a+602s renueva. El ledger conserva nombres/cantidades de procedimientos, sin entradas, cabeceras ni tokens. Lecturas de DB confirman las escrituras. UI en inglés; no se agregan cadenas traducibles.

## Evidencia y dependencias

Baseline main: dos fallos esperados de nombre en detalle de categoría/proveedor y cuatro pases (unidad y tres casos entre sesiones). Ambos tests de caché fallan por el nombre anterior sin parche. Los fallos previos de navegación/selectores/mock se conservan privados y se excluyen de las conclusiones del producto.

Se compara también el mismo fixture contra composición privada `fc6e0bb4185ce108ba5e6e1d22842c784af947ea`, con evidencia independiente del candidato. Contiene PR 340–350, incluidos dependencias y nota de release. Esta reparación no cambia lockfiles ni sustituye esos PR. El audit histórico y la nota faltante de main son gates separados; draft no significa listo para merge.

Orden de revisión/dependencias existente: 345 → 341 → 342 → 340 junto con 344 → 343 → 346/347 → 348 → 349 → 350, seguido de esta reparación. No es autorización de merge. No repitas audits idénticos rojos ni suprimas advisories; no merge/deploy. Se conserva la evidencia negativa acotada de lookups/N+1: esta matriz mide consistencia de caché y no repite el banco de rendimiento.
