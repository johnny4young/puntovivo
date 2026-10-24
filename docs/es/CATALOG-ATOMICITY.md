# Escrituras de catálogo e intenciones sync autoritativas

**Idioma:** Español · [English](../CATALOG-ATOMICITY.md)

## Objetivo y fallo

En app1.15.3/base404b5d7294ea021a5863d2149c79bf483a498b73, una mutación de
categoría, proveedor o unidad puede rechazar porque falla su inserción outbox
después de confirmar la escritura de negocio. Reemplazar categorías de un
proveedor puede confirmar relaciones y un intent delete antes de fallar un intent
create posterior. La operación rechazada deja estado parcial persistente,
incluso al reabrir el archivo SQLite.

La reparación agrupa cada escritura y sus intents autoritativos en una transacción
SQLite inmediata y síncrona. El borrado de proveedor conserva sus prechecks de
historial financiero/asignaciones y añade el intent antes del commit. Su creación
permanece en el caso de uso canónico. Se conservan versiones de categoría/proveedor,
conflicto de abreviatura de unidad, aislamiento tenant, payloads y respuestas. El
helper transaccional existente excluye deliberadamente el efecto best-effort del
journal; las rutas de catálogo no usan el envelope de comandos críticos. No se
convierte el journal en causa fatal nueva de una transacción.

## Reproducción

Usa un checkout desechable independiente con Node24.21.0 y pnpm11.7.0 local,
también para llamadas anidadas. Entorno limpio sin configuración heredada de
proveedores, bases, firma o telemetría; HOME/TMP/cachés propios y el lane pesado
cooperativo. No reutilices una DB de operador ni un listener existente.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/catalog-outbox-atomicity.test.ts --maxWorkers=1
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/units.test.ts src/__tests__/providers.test.ts src/__tests__/provider-payables.test.ts src/__tests__/optimistic-version.test.ts src/__tests__/tenant-isolation-mutations.test.ts --maxWorkers=1
corepack pnpm --filter @puntovivo/server run typecheck
corepack pnpm --filter @puntovivo/server run lint
corepack pnpm --filter @puntovivo/server run format
node scripts/check-documentation-translations.mjs
```

El fixture20casos crea y elimina su propio SQLite temporal por prueba, siembra
identidades sintéticas, arranca sin escuchar y no inicia workers de entrega. Un
trigger acotado por tenant/entidad/operación lanza
`Synthetic catalog outbox rejection`. No usa proveedor fiscal ni impresora física.
Compara filas tenant de categorías/proveedores/unidades/asignaciones y outbox. Un
rechazo debe conservar todo inmediatamente y al reabrir. El éxito debe confirmar
exactamente sus intents, persistir al reabrir y pasar integridad/foreign keys. El
reemplazo fuerza un fallo create posterior al intent delete, cubriendo lotes de
intents parciales.

Para comparar antes, copia solo este mismo test a un checkout aislado de la base
y ejecútalo:fallan10casos rollback y pasan10de éxito. Con la reparación pasan20/20.
Dependencias de recuperación probadas:Vitest5.0.3 ySQLite Node-API13.0.3; este PR no
cambia manifests ni lock. La composición congelada del PR344 ofrece ese grafo sin
hacer merge de ramas.

## Alcance y límites

Incluye create/update/delete de categorías/proveedores/unidades y reemplazo de
asignaciones. No añade versiones optimistas a unidades, cambia concurrencia de
jerarquías, redondeo, rechazo de promesas UI, esquema ni la desactivación de
productos de343. No borra historial financiero para permitir eliminar proveedor.

Este draft independiente requiere dependencias y documentación para CI completo;
no se suprime el audit de la base aislada. Reconcilia pares de traducción al
componer343/344/345. Suites relacionadas/tipos/lint y CI remoto deben registrarse
en el PR con SHA exacto. Pasar este fixture acotado no califica por sí solo el
navegador o runtime nativo.
