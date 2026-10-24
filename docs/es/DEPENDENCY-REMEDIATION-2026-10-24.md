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

## Migración de telemetría que cierra el gate estricto de deprecación

El grafo actualizado expuso exactamente `@opentelemetry/sdk-trace-base@2.10.0`,
por Sentry Node10.71.0 de la app y Node10.75.2 de Lighthouse. Sentry10.76.2 aún
requiere ese wrapper. Se rechazó el alias al paquete renombrado porque no incluye
`BasicTracerProvider`; no se publica.

Se revisó la [guía oficial de migración Sentry11](https://github.com/getsentry/sentry-javascript/blob/11.9.0/MIGRATION.md#upgrading-from-10x-to-11x)
antes de elegir Node11.9.0. Es una migración major deliberada, no un parche de la
misma línea: Node11 elimina el provider legacy y cambia valores de telemetría.
Node24.21.0 satisface sus engines. El SDK del navegador permanece en10; no cambian
su compatibilidad de navegador ni la política de datos del renderer.

El adaptador del servidor usa el tipo real del SDK instalado y elimina el cast
sin comprobación. Deshabilita explícitamente captura adicional y setupOTel,
apaga la inyección de canales e integraciones automáticas y usa transacciones estáticas en vez
del formato nuevo de spans en streaming. Se conservan las puertas de DSN y opt-in
por tenant. Se conserva el envelope Sentry/GlitchTip probado; no se contactó un
colector ni backend propio. Upstream soporta Sentry self-hosted26.4.2+; verificar
el formato no certifica una versión concreta de GlitchTip.

Lighthouse13.5.0 aún declara Node^10. Un override del owner usa11.9.0 tras probar
su wrapper real de init/tags/extras/breadcrumb/scope/error con SDK real y
transporte solo en memoria. El runner deshabilita explícitamente el reporte de
errores. Esto no califica cualquier configuración externa de la CLI Lighthouse.
El override conserva propietario, plazo y criterio de retiro; no se oculta
metadata ni se suprime la regla de deprecación.

Reproduce los controles nuevos en la composición congelada:

```sh
corepack pnpm run ci:shared
node --test scripts/sentry-sdk-compatibility.test.mjs
node node_modules/vitest/vitest.mjs run --root packages/server --config vitest.config.ts src/__tests__/observability-sentry-sdk.test.ts src/__tests__/observability-sentry.test.ts --maxWorkers=1
```

Antes: el gate compartido rechazaba el wrapper deprecado. Después: no hay entradas
deprecated; contratos de transporte real y prueba del adaptador verifican captura
en memoria propia, atributos primitivos, flush, opciones restrictivas y envelopes
de transacción estática. Se conservan las pruebas anteriores con mock. Consulta
el PR para cantidades finales y CI.

La nota curada1.15.3 faltante es una dependencia documental separada: [draft#345](https://github.com/johnny4young/puntovivo/pull/345). El tag y la
release existen; una nota retrospectiva debe usar evidencia histórica sin
atribuirles estas reparaciones nuevas de dependencias o productos. Esta rama no
reescribe el tag ni publica una release nueva.

## Límites de calificación

Consulta en el PR comandos, hashes exactos, cantidades y fallos de cada ejecución.
Una auditoría limpia no aprueba por sí sola `ci:server`, `ci:web` ni `ci:desktop`.
Sus gates de cobertura, build, navegador/runtime y mediciones siguen siendo
obligatorios. No uses Electron nativo, impresoras físicas, proveedores fiscales ni
datos de operadores sin la frontera aislada documentada. Los seguimientos de
atomicidad/UI y la política monetaria ambigua son trabajos separados.
