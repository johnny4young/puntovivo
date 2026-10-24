# Notificaciones de diálogo y accesibilidad

**Idioma:** Español · [English](../DIALOG-TOAST-ACCESSIBILITY.md)

## Objetivo y causa

En app 1.15.3/base `404b5d7294ea021a5863d2149c79bf483a498b73`, un toast de error creado mientras sigue abierto un modal se renderiza dentro de la raíz de la app. El diálogo aísla correctamente esa raíz con inert y aria-hidden. El aviso existe en el DOM, pero su alert y sus controles de recuperación quedan fuera del árbol accesible.

Es anterior a [#347](https://github.com/johnny4young/puntovivo/pull/347). Ese parche consume la promesa rechazada; no repara la frontera compartida de notificaciones. Conserva separados su resultado parcial y su CI histórico.

## Reparación mínima y contratos

ToastProvider conserva un host estable de portal React. El hook compartido registra el panel real de foco antes de calcular el aislamiento del fondo. El host pasa al panel modal superior registrado, regresa al drawer/modal inferior al cerrar un diálogo anidado y vuelve al body cuando no quedan diálogos. Se mantienen la identidad DOM y los temporizadores de los avisos existentes.

El fondo conserva inert y aria-hidden; no hay excepción global para notificaciones. Recuperación y descartar participan en el Tab trap existente del panel. Un aviso entrante no roba foco. Si desaparece el aviso enfocado, el foco vuelve a ese panel; que venza otro aviso no mueve el foco. Una acción del toast que abre un diálogo conserva un nodo real para restaurarlo al cerrar. Dentro de un diálogo, el aviso queda en el flujo con scroll acotado, evitando recortar un viewport fijo dentro del panel.

Solo cambia la ubicación de notificaciones y su integración con el hook. Sin dependencias, schema, fiscal, mutaciones de producto, permisos, redondeo, retiro global de inert ni cambios ajenos de arbitraje modal. Se conserva el manejo del rechazo de acciones del toast. Las comprobaciones DOM/ARIA no certifican la voz de un lector nativo; el laboratorio verifica semántica EN/ES y teclado en Chromium.

## Reproducción sintética

Node 24.21.0 y pnpm 11.7.0 local, incluidas llamadas anidadas. Checkout NUEVO, instalación congelada y DB propias, entorno hijo explícito limpio, HOME/TMP/cache propios y lane pesada cooperativa. Nunca reutilices una DB operativa, listener, perfil del navegador, Keychain o impresora.

El lock original tiene advisories. Para calificar el conjunto, reconstruye la receta fijada de [#344](https://github.com/johnny4young/puntovivo/pull/344) con #343/#345/Dependabot; aplica después los archivos fijados #346/#347 mediante el script de su descripción. Aplica los archivos de este PR y une su par de traducción en esa copia privada. No edites ramas ajenas ni concatenes locks. La descripción contiene heads finales y resultados medidos.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/components/feedback/__tests__/ToastProvider.dialog.test.tsx src/components/feedback/__tests__/ToastProvider.portal-lifecycle.test.tsx src/components/feedback/__tests__/ToastProvider.test.tsx src/components/form-controls/Modal.test.tsx src/components/feedback/__tests__/Drawer.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm --filter @puntovivo/web run test:coverage -- --run
corepack pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
node scripts/check-documentation-translations.mjs
```

Para antes, copia solo la fixture nueva de componente al código intacto con el mismo grafo congelado: fallan los seis casos de diálogo por alert/status inaccesibles. La fixture de ciclo de vida añade restauración del opener de una acción y expiración independiente de varios avisos. Esta última aporta UUID sintéticos distintos porque el setup global devuelve uno fijo; no oculta diagnósticos React.

La fixture real usa un trigger SQLite acotado al outbox y tenant/producto nuevos. Requiere #343 para rollback/versionado y #347 para consumir la promesa del renderer. Verifica un error localizado accesible, aislamiento del fondo, foco, Tab/Shift+Tab, descartar, cancelar/restaurar, reintentar, recargar/persistir y cero page errors escapados en EN/ES y claro/oscuro. El único HTTP500 esperado corresponde exactamente al products.delete rechazado a propósito. No añade allowlist global de consola.

Con los puertos exactos libres y el servidor compilado:

```sh
corepack pnpm --filter @puntovivo/server run build
corepack pnpm exec playwright test --config playwright.web.config.ts --project chromium e2e/web/product-deactivation-error-accessibility.spec.ts --workers=1
```

La configuración canónica posee la fixture plaintext packages/server/data/local.db y rechaza reutilizar servidores. En el laboratorio, una configuración propia además impide activar/emitir fiscal, limita tráfico saliente y registra puertos y conteos fiscales finales en cero. Conserva traces crudos privados: incluso las sesiones sintéticas llevan credenciales efímeras. Estas pruebas no califican Lighthouse/fiscal canónico ni Electron nativo. No declares lista la release mientras esas fronteras sigan sin resolverse.
