# Remediación de dependencias — 2026-10-24

**Language:** Español · [English](../DEPENDENCY-REMEDIATION-2026-10-24.md)

El grafo original 1.15.3 en `404b5d7294ea021a5863d2149c79bf483a498b73`
bloquea CI en la auditoría completa: 41 entradas de aviso/versión y 32 GHSA distintos.
La [matriz de revisión](../assets/dependency-review-2026-10-24.json) registra todos
los identificadores, versiones afectadas, rutas, parches y condiciones de exposición.
Una dependencia alcanzable no demuestra explotación de la aplicación; también deben
actualizarse las herramientas de desarrollo. No se relaja ninguna excepción de
auditoría, allowlist, umbral ni presupuesto de pruebas.

## Cambios existentes y orden

- [#340](https://github.com/johnny4young/puntovivo/pull/340) cubre `sanitize-html` 2.18.0.
- [#341](https://github.com/johnny4young/puntovivo/pull/341) cubre Vite 8.3.3.
- [#342](https://github.com/johnny4young/puntovivo/pull/342) cubre Electron 43.7.0.
  Esta rama de faltantes parte de esa rama y avanza Electron a 43.8.1: los avisos
  posteriores de permisos/GPU/TLS no quedan corregidos con 43.7.0.
- [#343](https://github.com/johnny4young/puntovivo/pull/343) cubre por separado la
  desactivación atómica y el rechazo de edición obsoleta. Su head y CI rojo histórico
  se conservan; una composición privada no cambia su calificación.

Revisa #340/#341 y #342 junto con los faltantes, reconcilia el lock compartido y
vuelve a validar con #343. La reproducción no edita ni hace merge de ramas ajenas.
La rama de faltantes por sí sola aún reporta los seis avisos de Vite cubiertos por
#341; no se presenta su auditoría como aprobada.

La composición también detectó GHSA-c9rx-x947-fp3h, una regresión de recursión
en iframes descartados de 2.18.0. El selector `sanitize-html@2.18.0` avanza esa
versión a 2.18.1. pnpm también aplica el rango al manifest original y su lock
resuelve 2.18.1; #340 conserva la declaración del piso en el manifest. Revisa
estos cambios coordinados en lugar de desplegar 2.18.0.

## Decisiones de compatibilidad

Fastify 5.12.6 y Zod 4.6.6 mantienen las líneas mayores del servidor. Vitest y
coverage avanzan juntos a 5.0.3. Los selectores acotados llevan DOMPurify a 3.4.17,
fast-uri a 3.1.9/4.2.3, undici a 6.29.1/7.30.1/8.12.2 e ip-address a 10.7.4.
Los peers Zod 4.4.3 avanzan dentro del major 4. Se actualizan propietario, fechas de
revisión y criterios de retiro de los overrides junto con sus versiones.

El Puppeteer 25.11.0 anterior de Lighthouse conservaba un consumidor Zod 3 en
Chromium BiDi. El rango del paquete padre admite Puppeteer 25.16.0, cuya migración
upstream de BiDi usa Zod 4. Este cambio mantiene el major público 25 de Puppeteer;
no fuerza Zod 4 sobre una biblioteca escrita para Zod 3. Node 24.21.0 satisface los
engines nuevos. Cambian versiones hijas del protocolo y se requieren contratos de
Lighthouse y una ejecución aislada real del navegador antes de calificar una entrega.
Electron mantiene el major 43 y no cambia la línea Node-API de SQLite/Argon2;
metadatos y pruebas Node no califican el binario nuevo ni su comportamiento de SO.

## Reproducir la composición privada

La [receta](../assets/dependency-composition-2026-10-24.json) fija heads revisados,
cambios de manifests y el checksum del lock combinado. El helper clona solo código
versionado a una carpeta nueva, aplica el cambio fijado de #343 y reconstruye la
intención de manifests de #340/#341 con el lock revisado. No instala, prueba,
publica ni hace merge y rechaza destinos existentes. Así se evita escoger a mano
un lado de snapshots peer en conflicto.

Usa Node 24.21.0 y pnpm 11.7.0, también para llamadas pnpm anidadas. Establece un
entorno hijo limpio sin configuración de proveedores, bases, firma o telemetría;
usa HOME/TMP/cachés temporales propios y el carril pesado cooperativo. No reutilices
una base real ni una aplicación escuchando. Desde el checkout de este PR:

```sh
node scripts/reproduce-dependency-composition.mjs ../puntovivo-composition
cd ../puntovivo-composition
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run ci:audit
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/products-deactivation.test.ts src/__tests__/products.test.ts src/__tests__/optimistic-version.test.ts src/__tests__/tenant-isolation-mutations.test.ts --maxWorkers=1
corepack pnpm --filter @puntovivo/server run typecheck
corepack pnpm --filter @puntovivo/web run typecheck
node --test scripts/check-lighthouse.test.mjs scripts/run-lighthouse-gate.test.mjs scripts/electron-fetch-download.test.mjs scripts/run-dependency-audit.test.mjs scripts/runtime-dependency-reachability.test.mjs scripts/check-exact-override-policy.test.mjs
node --experimental-strip-types --test apps/desktop/src/main/__tests__/print-html-sanitizer.test.ts
```

El lock actualizado también registra wrappers deprecated de
`@opentelemetry/sdk-trace-base` usados por Sentry 10. El owner compatible más
reciente, Sentry 10.76.2, aún los requiere. Se rechazó el alias directo al paquete
renombrado `@opentelemetry/sdk-trace`: no incluye `BasicTracerProvider`. No se
publica un alias incompatible ni se suprime la deprecación. Ese gate estricto
sigue bloqueado y requiere una migración de telemetría validada por separado.
La nota curada 1.15.3 que falta desde la base es otro gate de release; este
parche de dependencias no inventa evidencia de lanzamiento.

## Límites de calificación

Consulta en el PR comandos, hashes exactos, cantidades y fallos de cada ejecución.
Una auditoría limpia no aprueba por sí sola `ci:server`, `ci:web` ni `ci:desktop`.
Sus gates de cobertura, build, navegador/runtime y mediciones siguen siendo
obligatorios. No uses Electron nativo, impresoras físicas, proveedores fiscales ni
datos de operadores sin la frontera aislada documentada. Los seguimientos de
atomicidad/UI y la política monetaria ambigua son trabajos separados.
