# Validación de extremo a extremo

**Idioma:** Español · [English](README.md)

Pruebas de Playwright que manejan la aplicación web real (`apps/web`) contra el
backend real (`packages/server`) con almacenamiento `better-sqlite3`, más una
suite serial de Electron que maneja el entorno de ejecución de escritorio real
en desarrollo o desde una aplicación empaquetada.

## Ejecuta la suite web

```sh
pnpm run test:e2e:web
```

Para ejecutar solo el contrato acotado de cuatro recorridos de desarrollo/CI:

```sh
pnpm run test:e2e:web:critical
```

Ese subconjunto serial reutiliza los recorridos indexados de primera venta,
aprobación exacta del gerente, cierre diario inmutable y traslado de inventario
con discrepancia. Cubre una mutación real más su lectura persistida en cada área
operativa crítica; es una capa de protección rápida, no un reemplazo de la suite completa.

Para el contrato opcional de jornada prolongada en el mismo renderizador:

```sh
pnpm run test:e2e:web:soak
```

La prueba prolongada mantiene vivo un árbol de React autenticado, calienta sus
cachés finitas de rutas y consultas y luego realiza 30 ciclos medidos de modales
y paneles de productos/ventas. Chromium ejecuta GC antes de cada punto de control;
la muestra final debe respetar los límites de crecimiento de heap retenido,
documentos, nodos DOM y listeners de `perf-budget.json::longShiftSoak`. También
abre el diálogo real de OCR de compras, mantiene en curso la persistencia de la
carga, cierra la superficie y demuestra que la URL Blob exacta de vista previa se
revoca antes de que termine la respuesta tardía. El comando habitual
`test:e2e:web` excluye esta prueba etiquetada para mantener acotados sus recorridos funcionales.

El comando web local completo sigue ejecutando todos los recorridos funcionales
habituales. Primero ejecuta la suite paralela sin `@isolated-journey` y luego
inicia una invocación nueva de Playwright con un solo worker para los recorridos
etiquetados que son largos o usan fixtures intensivamente. Tres recorridos de
farmacia combinan deliberadamente custodia de productos de venta libre con
privacidad de recetas, retiros, traslados, devoluciones y vencimientos; la primera
configuración del propietario de comercio minorista usa un servidor separado de
instalación vacía; y la recuperación fiscal escribe un fixture directo en la
base de datos antes del arranque de autenticación. Estas siete pruebas completas
pasaron por separado, pero presentaron fallos sensibles a la carga en paralelo.
Aislar su worker no agrega reintentos, no aumenta sus límites por prueba ni
elimina aserciones del estado final.

Qué ocurre detrás de ese comando:

1. `scripts/ensure-playwright-browser.mjs` instala Chromium en
   `.playwright-browsers/` si la caché está vacía (las ejecuciones posteriores no tienen ese costo).
2. Se compila el workspace del servidor y luego `native:ensure:node` verifica
   que el addon SQLite Node-API incluido cargue en Node antes de que
   `globalSetup` de Playwright acceda a la base de datos.
3. Playwright inicia su propio servidor autónomo en loopback (puerto 8090 o el
   puerto de `PUNTOVIVO_E2E_API_ORIGIN`) y el renderizador Vite en el puerto 5173.
   Nunca reutiliza un listener existente; una colisión de puertos hace fallar la
   ejecución. Consulta `docs/TESTING.md`, sección de aislamiento de la suite web.
4. `e2e/web/global-setup.ts` prepara el tenant para las pruebas:
   - Elimina artefactos de ejecuciones anteriores (productos, proveedores,
     ventas, compras, traslados, sesiones de caja, filas de auditoría y usuarios
     desechables de E2E) para mantener pequeña la lista de productos y rápidas las pruebas.
   - Garantiza una sede secundaria (`E2E Branch Site`) para que el tenant tenga
     al menos dos sedes activas para traslados de inventario.
   - Crea cuatro usuarios de plantilla (`e2e.admin`, `e2e.manager`,
     `e2e.cashier`, `e2e.viewer`) con la contraseña compartida
     `PuntovivoE2E!123`.
5. Cada prueba prepara sus propios actores únicos (mediante `seedSaleScenario`,
   `seedPurchaseScenario`, `seedTransferScenario`, `seedCashSessionScenario`,
   `seedCashierWithoutSession`) para que las pruebas nunca compartan estado mutable.

Los pasos 3–5 se ejecutan una vez para el grupo paralelo y otra para el grupo
`@isolated-journey` aislado. Ambas invocaciones usan la misma configuración sin
reintentos y la misma política de artefactos de fallo. El segundo grupo escribe
en `test-results/playwright-web-heavy` y `playwright-report/web-heavy` para no
borrar los informes `playwright-web` y `web` del grupo paralelo.
El fixture de instalación vacía informa fallos de reenvío mediante campos
permitidos del transporte y del proceso hijo; nunca imprime encabezados de
solicitudes, datos de consultas de URL ni stderr sin procesar del proceso hijo.

## Vuelve a ejecutar una sola prueba

```sh
PLAYWRIGHT_BROWSERS_PATH=./.playwright-browsers \
  ./node_modules/.bin/playwright test --config=playwright.web.config.ts \
  -g "cashier closes a cash session with an overage"
```

## Qué cubre la suite

### Prueba de humo (`smoke.spec.ts`)

- El administrador recorre cada módulo de la barra lateral sin errores de
  consola del cliente, errores de red ni eventos `pageerror` sin manejar.
- La estructura principal del administrador muestra el selector de varias sedes
  y una ventana de tamaño tablet (820x1180) no introduce desplazamiento horizontal.
- Restricción de rutas: gerente, cajero y lector acceden a rutas ajenas a su rol
  y son redirigidos a su destino predeterminado.
- Localización al español: la navegación principal y la estructura del dashboard
  se muestran en `es` cuando `puntovivo-language-preference=es`.

### Flujos de negocio (`business.spec.ts`)

Ventas:

- El cajero completa una venta y solo ve acciones apropiadas para su rol.
- El gerente reembolsa una venta completada: se restaura el stock, se persiste
  la auditoría `sale.return` y Ventas e Inventario reflejan el reembolso.
- El administrador anula una venta completada: se restaura el stock y se crea
  una fila de auditoría `sale.void`.
- El gerente ajusta el stock: los saldos agregados y por sede se actualizan en
  conjunto y se crea una fila de auditoría `inventory.adjust_stock`.
- El cajero completa una venta con pago dividido: el panel de detalles muestra
  una fila por medio de pago.

Compras:

- El gerente registra una compra completada: aumenta el inventario en la sede
  receptora y el proveedor y el estado aparecen en el panel de detalles.
- El gerente devuelve parte de una compra: el estado cambia a
  `partial_returned`, el inventario vuelve a bajar y se conserva el motivo.
- El administrador anula una compra: se crea la auditoría `purchase.void` y se revierte el stock.

Traslados:

- El gerente traslada stock con una discrepancia: el destino recibe la cantidad
  **recibida**, el origen conserva el débito completo y las notas de discrepancia
  aparecen en la fila del historial y en el panel de detalles.
- El gerente recibe un traslado sin discrepancia: el destino recibe exactamente
  lo enviado; no aparece la etiqueta «Discrepancia».
- El gerente no puede confirmar una recepción que declare más de lo enviado:
  el botón Confirmar permanece deshabilitado y el traslado sigue en tránsito.

Sesiones de caja:

- El cajero abre una sesión de caja desde cero con un conteo equilibrado por denominación.
- El cajero registra un ingreso manual y el saldo de la caja activa aumenta en consecuencia.
- El cajero cierra una caja con sobrante: el sobrante/faltante es positivo, se
  crea la auditoría `cash_session.close` y el cierre aparece en el informe de Ventas.
- El cajero cierra con faltante: sobrante/faltante negativo y fila de auditoría.
- El cajero cierra con saldo exacto: sobrante/faltante cero y fila de auditoría.

Personal:

- El gerente registra condiciones laborales vigentes, ausencias y disponibilidad
  recurrente, y publica planes de horarios recurrentes mediante sus vistas acotadas dedicadas.
- El cajero solicita un intercambio entre dos versiones exactas de turnos
  publicados; el destinatario acepta en una sesión separada y un administrador
  independiente aprueba el reemplazo atómico.
- El recorrido de intercambio compartido se ejecuta en web y Electron, recarga
  la vista final del empleado, mantiene los motivos privados fuera de las
  proyecciones genéricas de auditoría/sincronización y, en web, concilia los
  turnos originales, el linaje de reemplazo, las solicitudes y los eventos
  inmutables directamente desde SQLite.
- E2E de Electron aumenta solo su límite global aislado de transporte para
  igualar el arnés web. Los límites de producción y todas las políticas de
  comandos y roles siguen vigentes.

## Convenciones de diseño de pruebas

- Cada prueba prepara datos únicos (SKU del producto, correo y nombre de caja
  incluyen un sufijo `randomUUID`) para evitar colisiones en ejecuciones paralelas.
- `data-row-id="<domain id>"` en cada fila de DataTable permite elegir una fila
  concreta aunque otras pruebas paralelas creen filas similares.
- Los helpers transversales (`login`, `resetSession`, `switchToSite`,
  `attachClientIssueTracker`) están en `e2e/web/support/app.ts`.
- Los lectores y preparadores de la base de datos están en
  `e2e/web/support/db.ts`. Usan SQL directo para no arrastrar la pila tRPC del
  servidor ni la caché de TanStack Query.
- El rastreador de incidencias del cliente exige **cero** errores de consola,
  errores de página o respuestas HTTP fallidas inesperadas al final de cada
  prueba. Las líneas transitorias conocidas (negociación de Vite, 401 en el
  `auth.refresh` inicial) se permiten explícitamente en `support/app.ts`.

## Licencias Free / Pro

**Actualmente no existe un nivel de licencia Free / Pro en el código de Puntovivo**.
El producto no define ningún indicador de funcionalidad por tenant ni nivel de
facturación. Por eso, la suite NO modela escenarios Free frente a Pro: hacerlo
sin una implementación real sería especulativo.

Si se incorporan licencias, cada funcionalidad restringida tendrá un escenario
dedicado (por ejemplo, `seedProScenario` para cambiar la licencia del tenant) y
las suites de humo y negocio se ampliarán con pruebas positivas y negativas por nivel.

## CI

CI de pushes y pull requests usa verificaciones por workspace filtradas por
rutas. La suite web completa de Playwright y la suite Electron siguen siendo
locales para que los cambios habituales no consuman los costosos minutos de
navegador/entorno de ejecución. El trabajo web sí ejecuta el contrato acotado de
cuatro pruebas `test:e2e:web:critical` después de `ci:web`, con un worker, sin
reintentos y con diagnósticos retenidos ante fallos. Ejecuta
`pnpm run test:e2e:web` localmente cuando cambien el inicio de sesión, las ventas,
el inventario, las importaciones o un flujo de navegador. Ejecuta
`pnpm run test:e2e:web:soak` después de cambios de ciclo de vida, modales/paneles,
caché de consultas o memoria del renderizador; CI sigue ejecutando sus pruebas
puras del comparador y del contrato de comandos sin el costo de la prueba prolongada real.

La validación de escritorio multiplataforma está en el workflow manual
`.github/workflows/build-desktop.yml`. Su modo de compilación completa empaqueta
el commit inmutable seleccionado en Linux, macOS y/o Windows, ejecuta la prueba
de humo del entorno empaquetado y sube evidencia del candidato. La firma y la
notarización siguen siendo responsabilidades del workflow de release.

## Ejecutor de Electron

La suite Electron (`e2e/electron/`) inicia el proceso principal contra una copia
aislada de una base de datos preparada y maneja el renderizador como una `page`
normal de Playwright. Detecta regresiones del proceso principal (puente IPC,
indicadores del sandbox, arranque del servidor embebido) y lleva recorridos
seleccionados que definen la jornada al escritorio. La matriz completa de roles
y flujos de negocio sigue en la suite web.

### Requisitos previos

Ejecuta E2E de Electron mediante el script raíz:

```sh
pnpm run test:e2e:electron
```

Ese comando recompila los bundles principal y preload de Electron y copia las
migraciones de Drizzle a `.vite/build/migrations/` antes de iniciar Playwright.
No uses `vite build --config vite.main.config.ts` como atajo: Forge inyecta los
puntos de entrada de Electron y Vite por sí solo compila el destino equivocado.
Si invocas Playwright directamente, recompila primero los bundles:

```sh
pnpm --filter @puntovivo/desktop run build:main
```

Si faltan los bundles, `scripts/ensure-electron-main-build.mjs` falla de inmediato
con el mismo comando.

### Ejecución

```sh
pnpm run test:e2e:electron

# or web + electron back-to-back:
pnpm run test:e2e

# drive a freshly packaged macOS directory instead of the dev bundle:
PUNTOVIVO_PACKAGED_APP=apps/desktop/out-builder/mac-arm64 \
  pnpm run test:e2e:electron:packaged
```

Para evidencia representativa de release, usa el wrapper externo más estricto
desde una sesión interactiva normal de Terminal/iTerm/Windows Terminal, nunca
desde Codex, XCTest, CI ni otro host de automatización con inyección:

Genera un identificador de correlación nuevo con `node -p "crypto.randomUUID()"`
y úsalo en el comando y en el borrador de Gate 5 correspondiente:

```sh
pnpm run test:e2e:electron:external -- \
  --candidate-root /absolute/path/to/a/clean/candidate-worktree \
  --packaged-app /absolute/path/to/the/installed/signed/Puntovivo.app \
  --session-id 018f6f8c-4e5b-7a21-8abc-1234567890ab \
  --output .artifacts/gate5/current-host/external-electron.json
```

El wrapper rechaza un árbol candidato con cambios, un destino empaquetado
faltante, ejecución sin TTY, `TERM=dumb` y señales de
CI/Codex/XCTest/inyección de bibliotecas dinámicas antes de iniciar Electron.
Maneja el candidato firmado instalado mediante el fixture CDP empaquetado y
luego escribe un informe sanitizado vinculado al SHA del candidato, versiones
de la app/Electron/Node, SO/arquitectura, comando exacto, duración, UUID de sesión
de Gate 5 y resultado de salida. Nunca contiene el hostname, la ruta local,
identificador de dispositivo ni identidad del usuario. Una suite fallida sigue
siendo evidencia fallida; no hay excepciones permitidas para `SIGTRAP`,
`SIGABRT` ni excepciones de frameworks privados de Apple. El UUID de sesión es
un identificador de correlación de evidencia, no de máquina; usa el mismo valor
en el borrador de Gate 5.

`--candidate-root` es especialmente importante para un SHA histórico publicado:
el wrapper vive en el checkout actual de herramientas, pero ejecuta
`pnpm run test:e2e:electron:packaged` en el worktree candidato limpio separado
mientras `PUNTOVIVO_PACKAGED_APP` apunta al artefacto instalado. Instala primero
las dependencias y bindings nativos de ese worktree. Consulta la sección
representativa de Gate 5 en `docs/TESTING.md` para el contrato de artefactos de
instalación firmada, actualización y reversión de versión.

Qué ocurre:

1. Se compila `@puntovivo/server` para poder importar los helpers compilados de
   arranque de la base de datos.
2. Para ejecuciones de desarrollo, `electron:ensure:binary` verifica que exista
   el binario de Electron y que tenga una firma de código válida de macOS al
   ejecutarse allí. También puede reparar un Electron.app local dañado con una
   instalación nueva más firma ad hoc.
3. Para ejecuciones de desarrollo,
   `pnpm --filter @puntovivo/desktop run build:main` recompila los bundles Vite
   principal y preload que inicia Electron y copia las migraciones de Drizzle
   junto al servidor empaquetado.
4. Para ejecuciones de desarrollo, `ensure-electron-main-build.mjs` verifica que
   existan los bundles recompilados. Las ejecuciones empaquetadas manejan el
   artefacto proporcionado sin recompilar sus bundles principal/preload ni
   instalar un entorno de desarrollo.
5. Se verifica el binario SQLite Node-API compartido en Node para que
   `globalSetup` de Playwright pueda preparar la base de datos.
6. Las ejecuciones de desarrollo inician el comando `dev` del workspace web
   para servir el renderizador en el puerto 3000, sin reutilizar un servidor
   existente. Las ejecuciones empaquetadas usan el renderizador
   `puntovivo-app://` del artefacto y no inician Vite. Electron inicia su propio
   servidor Fastify embebido en el puerto loopback 18091 (configurable con
   `PUNTOVIVO_E2E_API_PORT`); el servidor del renderizador no es el backend de
   aplicación de esta suite.
7. `playwright.electron.config.ts` ejecuta `e2e/electron/global-setup.ts`, que:
   - Elimina `test-results/electron-userdata/` y
     `test-results/electron-userdata-template/` de ejecuciones anteriores.
   - Llama a `initDatabase` para crear una base de datos de plantilla cifrada
     en `test-results/electron-userdata-template/data/local.db` con la clave
     E2E explícita, todas las migraciones de Drizzle y la carga de datos predeterminados.
   - Ejecuta `prepareBaseline()` de `e2e/shared/baseline.ts` para crear o
     actualizar los 4 usuarios de plantilla y garantizar que exista la sede secundaria.
8. Para cada prueba, el fixture `electronApp` de `e2e/electron/fixtures.ts`
   copia la plantilla cifrada a un directorio userData único por prueba (los
   recorridos de instalación vacía comienzan vacíos). Las ejecuciones de
   desarrollo verifican el mismo addon Node-API en Electron y lo inician con
   `--user-data-dir=<tmpdir>`; las empaquetadas inician el artefacto seleccionado
   y se conectan por CDP. Los diagnósticos del proceso siguen siendo parte de la
   prueba. El fixture `page` expone el renderizador real; el modo de desarrollo
   usa `electronApp.firstWindow()`.
9. Workers=1 y retries=0. La suite Electron sigue siendo serial porque los
   inicios comparten el puerto API aislado, aunque cada prueba tiene su propia base de datos.

### Cobertura

La suite incluye la siguiente prueba de humo de plataforma y recorridos de
operador independientes del destino; la lista destaca cobertura principal y no
un número fijo de pruebas:

- `smoke.spec.ts`: inicio, autenticación, estructura de la aplicación,
  configuración de dispositivos, historial de auditoría, respaldo, bóveda en la
  nube y preparación para restauración.
- `first-sale.spec.ts`: creación de producto, apertura de caja, primer cobro y
  confirmación de finalización.
- `suspended-cart.spec.ts`: guardar un carrito, cobrar otro y luego reanudar y cobrar el primero.
- `split-tender.spec.ts`: liquidar una venta con efectivo y tarjeta.
- `manager-approval.spec.ts`: mantener montado el cobro exacto del cajero
  mientras un gerente habilitado presenta un PIN nuevo y luego demostrar el
  consumo del permiso de un solo uso y la evidencia de auditoría inmutable correlacionada.
- `blind-close.spec.ts`: cerrar una caja con discrepancia sin revelar primero el saldo esperado.
- `day-close.spec.ts`: aprobación del gerente, confirmación irreversible,
  verificación del PDF almacenado y evidencia inmutable después de recargar.
- `refund.spec.ts`: autoridad directa de reembolso del gerente, inventario
  restaurado y evidencia de auditoría inmutable de actor y motivo después de recargar.
- `inventory-receipt.spec.ts`: detalles de recepción de compra completada,
  efectos exactos en stock agregado y por sede, y evidencia de recepción
  inmutable atribuida al actor después de volver a autenticarse.
- `inventory-transfer.spec.ts`: débito exacto entre sedes, custodia en tránsito,
  recepción con discrepancia, efectos en stock agregado y por sede, y evidencia
  de traslado inmutable atribuida al actor después de volver a autenticarse.
- `staff-switch.spec.ts`: registro de PIN de cajero por el administrador,
  transferencia de autoridad en la misma estación, denegación de rutas
  privilegiadas, continuidad del cajero tras recargar el renderizador y evidencia
  inmutable de actor/destinatario del cambio después de volver a autenticarse.

Cada spec también exige diagnósticos limpios del renderizador y del proceso Electron.

### Solución de problemas

Si Playwright informa `Target page, context or browser has been closed` antes de
que aparezca el formulario de inicio de sesión, verifica primero el entorno de Electron:

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --version
```

En macOS debe imprimir la versión fijada de Electron, actualmente `v43.8.3`.

Tanto los inicios E2E de desarrollo como los empaquetados aíslan el almacenamiento
de credenciales de Chromium (`--use-mock-keychain` en macOS,
`--password-store=basic` en Linux). Esto evita que un entorno recién instalado
solicite acceso al Llavero del operador y bloquee IPC posterior. La base de datos
de prueba cifrada sigue usando la clave E2E explícita; este aislamiento del arnés
no acredita el almacenamiento de claves de producción.

No pases fragmentos `-e` al estilo Node al binario de Electron; Electron interpreta
el fragmento como una ruta de aplicación y abre un diálogo engañoso «Unable to
find Electron app».

Si `--version` termina con `SIGABRT` desde una sesión de agente en sandbox pero
funciona en una terminal normal, puedes volver a ejecutar la suite habitual desde
una sesión con permiso para iniciar apps gráficas. Para evidencia representativa
retenida, usa el wrapper externo anterior; no copies el resultado de la ejecución
habitual en su informe. Si el entorno también falla en una terminal normal,
ejecuta `pnpm --filter @puntovivo/desktop run electron:ensure:binary` y luego
`pnpm --filter @puntovivo/desktop run rebuild`.

### Fuera de CI

La suite de recorridos Playwright Electron es solo local. El workflow manual de
compilación de escritorio aporta la prueba de humo multiplataforma del entorno
empaquetado; no reemplaza la suite local completa de recorridos. La validación de
release firmado sigue separada porque los runners habituales de CI no tienen el
material de firma necesario.

## Recorridos de atención de pedidos y fuentes externas

`web/external-orders.spec.ts` crea el conector desde la interfaz de administración,
envía eventos firmados de la fuente por el endpoint tRPC real, acepta precios
locales, reanuda y cobra un borrador y verifica la evidencia de stock/caja
directamente en la base de datos aislada. Un segundo recorrido verifica
cancelación, descarte explícito del borrador, rotación de claves y cancelación
antes de la creación. El backend propiedad de Playwright usa una clave efímera
de envoltura del conector; esto no cambia la base de datos de fixture en texto
plano ni el requisito de cifrado de la base de datos en producción.

`web/reservations.spec.ts` cubre llegada/asignación de mesa explícitas en POS
tradicional, Mobile Waiter y Touch. `web/delivery.spec.ts` cubre logística manual
y respaldada por ventas. Los equivalentes de Electron se ejecutan contra el
servidor embebido y userData cifrado por prueba: el adaptador de fuente usa HTTP,
pero las escrituras del operador permanecen en la interfaz. Estos recorridos no
acreditan certificación de proveedores, instalación firmada ni hardware.

### Entrada nativa frente a automatización de escritorio

En macOS, el fixture Electron de desarrollo impide que sus propias ventanas
nativas reciban foco y retira explícitamente cualquier foco existente. Playwright
sigue manejando el renderizador real en sandbox y el backend embebido mediante
CDP, incluidas aserciones de teclado y foco del DOM. Esto evita que escritura o
atajos ajenos del operador entren en credenciales o cobros sintéticos durante la
automatización. Cada inicio verifica el aislamiento nativo antes del recorrido.
Las preferencias de ventanas de producción, los destinos empaquetados, Linux y
Windows no cambian. Estos recorridos automatizados no acreditan la entrada de
teclado físico ni el comportamiento del foco de ventanas nativas; eso requiere
una prueba de humo separada a cargo del operador.
