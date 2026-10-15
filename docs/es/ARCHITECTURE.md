# Arquitectura de Puntovivo

**Idioma:** Español · [English](../ARCHITECTURE.md)

Puntovivo es un monolito modular con prioridad local. El navegador y el renderizador
de Electron comparten una aplicación React; Fastify y tRPC controlan las API del
negocio; SQLite es la autoridad operativa. En Electron, el servidor Fastify se
ejecuta dentro del proceso principal, en lugar de ser un proceso hijo.

![Arquitectura de Puntovivo](../architecture.svg)

Diagrama de origen: [architecture.mmd](../architecture.mmd).

## Mapa del repositorio

| Ruta              | Responsabilidad                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | Aplicación React, rutas, controles de rol/módulo, flujos de usuario, i18n y pruebas de navegador.                                                                     |
| `apps/desktop`    | Ciclo de vida de Electron, ventana con aislamiento de seguridad, puente preload, actualizador, periféricos locales, almacenamiento cifrado y operaciones de respaldo. |
| `packages/server` | Host Fastify, routers tRPC, servicios de aplicación, persistencia, workers, fiscalidad, sincronización, pagos y pruebas.                                              |
| `packages/shared` | Contratos entre espacios de trabajo, como roles, dinero y tipos de aprobación.                                                                                        |
| `e2e`             | Recorridos de extremo a extremo de navegador y Electron.                                                                                                              |
| `scripts`         | Controles de CI, publicación, rendimiento, configuración, migración y runtime.                                                                                        |

## Estructura de ejecución

```text
React renderer
  -> tRPC client
    -> Fastify /api/trpc
      -> authenticated tenant/site context
        -> role and site guards
          -> application services
            -> Drizzle + SQLite transaction
              -> audit, journal, and outbox evidence
```

El destino navegador se conecta a un proceso Fastify independiente. El destino
Electron importa `@puntovivo/server` directamente en el proceso principal y
sirve la misma superficie tRPC a su renderizador.

## Límites de API y aplicación

- `/api/trpc` es la API canónica de la aplicación.
- `/api/health` sigue siendo un endpoint de compatibilidad y salud operativa.
- `/api/realtime/*` transporta eventos enviados por el servidor mediante la
  sesión canónica de acceso Bearer. Los renderizadores de navegador y autoridad
  local usan `fetch` en streaming; los clientes Store Hub usan un intermediario
  de endpoint fijo en el proceso principal. El servidor revalida `sessionVersion`
  antes de cada señal de actividad para que cerrar sesión, revocar un dispositivo
  y deshabilitar usuarios o negocios cierren los flujos existentes.
- Los routers validan entradas, autorizan al actor, aplican el alcance de
  negocio/sede y delegan reglas no triviales a módulos de aplicación o servicios.
- Las pruebas de servidor llaman a `appRouter.createCaller(...)` contra SQLite
  en memoria; no asignan puertos HTTP.
- Toda operación que acepta un identificador de sede valida que pertenezca al
  negocio activo.
- La pantalla de voz del cajero lee solo `ai.settings.voiceAvailability`, una
  bandera de habilitación por negocio protegida por `semantic-search`. La
  proyección completa de `ai.settings.get` (proveedor, presupuesto, gasto y
  cuotas) sigue siendo exclusiva de gerente/administrador; una comprobación de
  capacidades de UI no debe ampliar ese contrato.

### Límite de Companion

`/c` es una superficie instalable de solo lectura, no una copia reducida de la
aplicación del gerente. Administrador, gerente y lector llaman a un único
procedimiento `companion.snapshot` protegido por módulo. Su modelo de lectura
con zona horaria del negocio contiene solo totales acotados, doce referencias
anónimas de ventas recientes, atención agregada y metadatos del firmante del
cierre diario con integridad verificada. El cajero queda excluido.

La entrada sin autenticar por `/c` vuelve directamente a esa superficie después
de iniciar sesión, sin montar primero el tablero. El destino de retorno acepta
solo la ruta exacta de Companion y sus roles permitidos, no URL de redirección
arbitrarias. Los inicios de sesión ordinarios conservan su destino predeterminado
según rol/preparación.

La colección SSE `companion` lleva solo alcance de invalidación y marca de tiempo;
nunca lleva totales de clientes, líneas, sedes o ventas. La colección detallada
anterior `sales` sigue siendo exclusiva de gerente/administrador por
compatibilidad. Un service worker generado se registra solo desde la ruta de
Companion HTTP(S) de producción y precarga una lista exacta de recursos permitidos
de la estructura de la aplicación, versionada por contenido. `/api/*` siempre
usa solo la red. Pasar a modo sin conexión reinicia la caché de instantáneas
autenticadas, por lo que reconectar debe completar una lectura nueva antes de
mostrar de nuevo las tarjetas operativas.

### Límite de la Pantalla del cliente

`/customer-display` arranca como proyección local sin autoridad; no monta
`AuthProvider`, consultas de negocio ni proveedor tRPC, no es una segunda
autoridad transaccional y no consume un carrito sin procesar ni un flujo general
de eventos de ventas. Su arranque no instala el informador Web Vitals, por lo que
ni siquiera el RUM de mejor esfuerzo puede crear una solicitud a la API de la
aplicación desde el renderizador público. El renderizador de cobro publica un
sobre versionado mediante `BroadcastChannel`, con `localStorage` acotado como
alternativa ante recargas y ventanas de navegador. Una capacidad UUID aleatoria
empareja publicadores de cobro activos de un negocio/sede; solo ese valor opaco
de emparejamiento entra en la URL de la pantalla. Cerrar sesión elimina la
capacidad y todas las proyecciones. La pantalla vuelve a sanear el sobre y falla
de forma segura ante discordancia de emparejamiento/alcance, entrada malformada,
desfase de reloj, obsolescencia o estado sin conexión.

El contenido de venta visible al cliente es una lista permitida: nombre mostrado
del producto, etiqueta de unidad, cantidad, precio unitario, descuento, total de
línea y totales de venta. Su sobre de alcance lleva necesariamente identificadores
opacos de negocio, sede y sesión de caja, pero los identificadores de producto,
unidad, cliente, empleado, pago, receta, nota, stock, serial, SKU, impuesto y otros
datos comerciales no forman parte del contrato de venta mostrado. La detección
de cajas lee solo sobres recién publicados localmente con la capacidad exacta
de emparejamiento; el renderizador auxiliar no tiene procedimiento de servidor
de Pantalla del cliente, token de acceso, identidad de empleado, saldo de caja,
denominación, turno ni configuración de plantilla.

En Electron, el proceso principal controla una sola `BrowserWindow` reutilizable
de Pantalla del cliente; las solicitudes repetidas enfocan esa ventana en lugar
de crear otro renderizador, mientras las concurrentes del mismo emparejamiento
comparten una carga en curso y otro emparejamiento concurrente falla explícitamente.
El IPC de apertura deriva primero el negocio de la sesión verificada del proceso
principal; una sesión ausente u obsoleta no puede alcanzar la validación de
emparejamiento ni la creación de ventana y cruza preload mediante el sobre acotado
`SESSION_NOT_REGISTERED`. La apertura no informa éxito hasta que `loadURL` termina
correctamente; una carga fallida rechaza a todos los solicitantes en espera,
destruye la ventana parcial y devuelve un error acotado de UI. La ventana usa el
sandbox y el aislamiento de contexto habituales más un preload dedicado sin
capacidades: no expone puentes de Electron, sesión, runtime, Hub, respaldo,
sistema de archivos, actualizador, impresión, base de datos, sincronización ni
dispositivos. La apertura en navegador crea un contexto vacío con nombre, corta
`opener` antes de cargar código de la aplicación y luego navega; una referencia
conservada permite reutilización real sin el comportamiento de falso nulo/ventana
duplicada de `noopener` en Chromium. Cerrar la pantalla afecta solo esa ventana
auxiliar; cuando la ventana POS propietaria se cierra realmente, el proceso
principal también destruye la pantalla para que una proyección sin propietario
no mantenga vivo el proceso. Cerrar a la bandeja solo oculta el POS y, por tanto,
conserva la pantalla activa.

## Invariantes de persistencia

- Las migraciones de Drizzle son la única vía para cambiar el esquema.
- Toda consulta comercial se limita al negocio. Los flujos propios de una sede
  añaden alcance de sede.
- El dinero se almacena y valida según el contrato compartido de redondeo.
- Completar una venta exige una sesión de caja activa para negocio, sede y cajero.
- Los recursos mutables versionados usan actualizaciones de comparación e
  intercambio e informan conflictos sin sobrescribir silenciosamente cambios
  concurrentes.
- Los desempates de pagos por IA crean propuestas duraderas de revisión por
  negocio, nunca liquidaciones. Una decisión administrativa revalida el extracto
  seleccionado del proveedor y la fila de outbox antes de un cambio de estado
  atómico con auditoría; consulta [ADR-0031](../architecture/0031-human-review-of-ai-payment-proposals.md).
- Los efectos de pagos, hardware y sincronización usan outboxes duraderos
  dedicados. Una venta completada con fiscalidad habilitada registra primero
  una intención congelada de emisión dentro de la transacción de venta; el
  worker fiscal la materializa atómicamente en documento fiscal y outbox del
  proveedor antes de entregar.
- El reconocimiento genérico de outbox exige negocio, fila, estado de
  procesamiento y token de reclamación actual. La evidencia final fiscal/de
  entrega y el reconocimiento comparten una transacción inmediata síncrona;
  las respuestas sustituidas informan pérdida de propiedad sin modificar al
  ganador. Los efectos remotos siguen siendo al menos una vez. Los metadatos
  opcionales de aceptación fiscal y salud usan puntos de guardado de mejor esfuerzo.
- Las mutaciones de stock de compras y órdenes de inventario completan sus
  filas comerciales por negocio/sede, evidencia de auditoría, filas de outbox
  de sincronización, resultado canónico de repetición y éxito de idempotencia
  en una transacción `BEGIN IMMEDIATE`. Un fallo o repetición no puede confirmar
  stock sin su evidencia autorizada de sincronización.
- Crear ventas, completar borradores y realizar devoluciones normalizadas
  completa filas de dominio, evidencia de auditoría, filas de outbox de
  sincronización, referencia canónica de repetición y éxito de idempotencia
  en la misma transacción `BEGIN IMMEDIATE`. Las ventas completadas con
  fiscalidad habilitada también congelan entradas de comprador, líneas,
  impuestos, configuración regional, configuración y resolución de numeración
  en `fiscal_emission_intents` dentro de esa transacción. Despertar el worker,
  entregar al proveedor, difundir en tiempo real y resumir en el diario después
  de confirmar siguen siendo efectos explícitos de mejor esfuerzo, ajenos a
  la confirmación de dinero y stock; una señal interrumpida no puede borrar la
  obligación fiscal duradera.
- Los movimientos de inventario llevan una clave foránea explícita de sede
  que admite nulos. Los escritores actuales siempre proporcionan la sede
  autorizada; la migración rellena solo relaciones demostrables de venta,
  compra, devolución e inventario inicial, dejando sin atribuir ajustes o
  transferencias históricas realmente ambiguos.
- Un conteo físico a ciegas es una sesión propia de una sede con instantáneas
  inmutables y exactas del saldo contable con signo, revisión del saldo, unidad
  base y costo. Las lecturas de conteo ocultan esos campos hasta el envío. Cada
  escritor de saldo activo avanza una revisión comercial independiente de los
  metadatos del transporte de sincronización. La aprobación se ejecuta bajo un
  escritor SQLite reservado, rechaza cambios de cantidad, revisión, unidad base
  o política de seguimiento en lugar de recalcular la base, y confirma
  atómicamente evidencia del conteo, movimientos de discrepancia, cambios de
  saldo, auditoría, intención de sincronización y resultado del comando. Los
  conteos agregados no pueden modificar identidades de lote o serial. Las líneas
  conscientes de identidad congelan un modo de seguimiento e instantáneas
  normalizadas de identidades propias de negocio/sede/producto. Las revisiones
  de custodia de lotes/seriales pertenecen a triggers y son independientes de
  reconocimientos de sincronización; comparar el conjunto completo rechaza
  sustituciones y ABA antes de escribir. Los seriales faltantes conservan su
  estado anterior en stock/devuelto; los lotes redescubiertos con stock cero
  requieren cuarentena, mientras retiro/vencimiento/cuarentena sobreviven a
  todos los ajustes. Los conteos nunca fabrican procedencia de recepción. Las
  observaciones de seriales son a ciegas: los códigos esperados no escaneados
  no aparecen en la respuesta. Todo el conteo se limita a 10,000 identidades;
  excederlo falla de forma segura sin truncar. Los registros de sincronización
  de sesión, línea e identidad permanecen solo locales, incluidos los pendientes
  históricos adoptados, hasta que exista un transporte consciente del agregado.
- La reposición es una proyección de lectura, no un escritor automático de stock.
  Compara stock mínimo con stock disponible por sede más cantidades aún no
  recibidas de pedidos en borrador, enviados o recibidos parcialmente. Aceptar
  una sugerencia crea solo un borrador de orden de compra; el envío explícito
  precede a la transacción de recepción existente y abandonar el borrador no
  afecta stock ni cuentas del proveedor.
- Las recepciones de compras y pedidos con seguimiento por lote exigen filas
  concretas de lotes cuyas cantidades base concilien exactamente con la línea
  recibida. Las devoluciones al proveedor y anulaciones de compra descuentan
  solo esa procedencia congelada y rechazan un lote actual cuyo número,
  vencimiento o costo unitario ya no coincida con la instantánea de recepción.
  El detalle de compra distingue el derecho de recepción aún no devuelto de lo
  físicamente retornable ahora: saldo de sede para stock ordinario, identidades
  exactas de origen para seriales y lotes congelados aún presentes cuya sede,
  producto, número, vencimiento y costo sigan coincidiendo con la recepción. La
  UI ofrece solo esa proyección, mientras la transacción de escritura la
  revalida de forma independiente bajo concurrencia. Las transferencias congelan
  el lote origen exacto, estado, vencimiento, costo, capa de destino y discrepancia
  para que un movimiento o reversión no sustituya otro lote ni reactive stock
  no vendible.
- Las recetas de transformación de inventario describen entradas esperadas
  globales o por sede y salidas ponderadas. Una ejecución congela cantidades
  reales, número/vencimiento/estado exactos de los lotes de entrada, identidades
  de salida, desperdicio, asignación de costos, ambas bases de costo del producto
  antes/después de contabilizar, actor, movimientos, auditoría, sincronización
  y evidencia de repetición en una transacción de escritura. Las entradas sin
  lote usan la misma base `initialCost` que consume la valoración de inventario;
  las salidas actualizan esa base y el `cost` distinto del catálogo atómicamente.
  El desperdicio es evidencia de entradas ya consumidas, no otro débito. Anular
  solo tiene éxito mientras sigan intactos cada identidad congelada de entrada,
  revisión de saldo de salida, ambos costos del producto con su revisión de
  sincronización y lote de salida.
- El diario operativo y el registro de auditoría conservan quién cambió estado
  sensible y qué efectos se confirmaron.
- La evidencia firmada de cierre diario y las instantáneas fiscales son inmutables.
- Las ventas completadas congelan cliente, sede, cajero, nombre y SKU del
  producto, identidad/contacto de empresa, identificación tributaria del cliente,
  diseño de plantilla ordinaria de recibo, origen del logo e idioma del recibo.
  Marcadores de versión separados distinguen campos de identidad o presentación
  deliberadamente vacíos al vender de filas anteriores a la migración, que
  conservan la alternativa de compatibilidad con filas actuales. Una venta
  completada sin plantilla activa sigue en el renderizador heredado aunque se
  configure una plantilla después.

## Límite del calendario de informes

El día actual del tablero, su serie de ingresos de treinta días calendario y
sus productos principales de siete días usan la zona resuelta por
`services/tenant-locale.ts`: excepción explícita del negocio, valor predeterminado
del país y, por último, la alternativa existente sin configuración.
`services/reports/day-window.ts` convierte cada fecha calendario en un intervalo
UTC semiabierto, incluidos días con horario de verano y medianoches locales
omitidas. Los informes nunca suman 24 horas fijas para avanzar un día local ni
reescriben marcas de tiempo almacenadas.

Las ventas completadas se atribuyen por `checkoutCompletedAt`, usando `createdAt`
solo para filas históricas sin telemetría de finalización. Las devoluciones restan
importes inmutables en su propio día de registro, no en el día original de venta.
El dinero y número de pedidos de hoy son el mismo agregado que el último intervalo
del gráfico. Los pedidos devueltos por completo siguen excluidos del volumen de
operaciones, mientras ambos eventos monetarios fechados siguen visibles. Los
productos principales conservan su política de cantidad neta positiva y excluyen
eventos de venta y devolución fuera de la misma ventana local acotada del informe.

Las etiquetas de calendario siguen siendo valores de solo fecha en la UI. Un
cambio correcto de configuración regional invalida el agregado del tablero y el
formato regional; una zona antigua en caché no debe sobrevivir a la actualización
de configuración. Las escrituras regionales rechazan zonas con nombre no
compatibles y desfases numéricos fijos. Una excepción heredada inválida cierra
el tablero de forma segura con `TENANT_TIMEZONE_INVALID` e instrucciones de
reparación localizadas; nunca sustituye silenciosamente otro calendario. Los
administradores pueden corregir la excepción o borrarla para restaurar la
herencia del valor predeterminado del país.

## Almacenamiento local y recuperación

Las bases de datos de Electron empaquetado usan SQLCipher. La clave se obtiene
mediante almacenamiento seguro de Electron y nunca pasa al renderizador. Node y
Electron comparten el binario Node-API v13 de better-sqlite3 incluido para la
plataforma de destino. Las comprobaciones previas ejecutan una prueba SQLCipher
bajo Node o Electron, y el empaquetado de escritorio elimina todo binario nativo
ajeno al destino antes de firmar. Forge y electron-builder no recompilan estos
complementos portátiles; los califica la prueba de runtime, no una recompilación
específica de ABI. Las compilaciones de producción de main/preload ejecutan los
hooks públicos del plugin Forge Vite desde la misma configuración de desarrollo,
sin invocar empaquetado ni publicación de Forge.

Los respaldos son paquetes cifrados con inspección de integridad. Su creación
hace primero un checkpoint del WAL, deriva claves de contraseña de forma
asíncrona mediante una cola scrypt acotada y transmite la base a un ZIP atómico
en el mismo directorio. Restaurar valida el directorio central acotado y los
registros locales antes de extraer entradas conocidas de archivos normales a
archivos temporales privados; contenido duplicado, desconocido, con escape de
rutas, enlaces simbólicos, solapamientos, truncamientos, tamaño excesivo o
integridad discordante falla de forma segura antes de publicarse. Los nombres
del paquete v2, derivación de claves, hashes, MAC y lectura de deflate heredado
permanecen estables. Instantáneas programadas, simulacros de restauración, estado
de protección de respaldos y carga a bóveda en la nube compatible con S3 siguen
siendo capacidades del proceso principal.

## Límite de perfiles sectoriales, cantidad y GS1

Ferretería y carnicería son perfiles operativos sobre el núcleo minorista
compartido, no bases separadas de productos/catálogos. Aplicar uno registra el
tipo de negocio y cambia solo su parche de módulos de superficie controlado por
el servidor. Nunca crea ni reescribe productos, categorías, unidades, stock,
lotes, seriales, ajustes de IA ni integraciones.

Las plantillas de creación de productos son operaciones explícitas de formulario
sin guardar, disponibles solo para el perfil seleccionado. Resuelven una unidad
activa existente con la dimensión física requerida; una plantilla por peso
requiere además su factor canónico positivo de masa. Configuran campos de
longitud/serial/lote o corte pesado/empacado, conservan la cuadrícula de precios
actual con alternativa segura para niveles 2/3 y dejan el formulario intacto si
la unidad falta o es incompatible. Una plantilla de corte no consume stock ni
crea evidencia de transformación por sí misma. Los gerentes configuran y ejecutan
esas entradas, salidas, rendimiento, desperdicio, remanentes y costos distribuidos
en la superficie separada de Transformación de inventario definida por
[ADR-0018](../architecture/0018-lot-procurement-and-transformations.md).

La constante compartida `0.001` es el menor incremento expuesto por los controles
actuales de productos, unidades alternativas, carrito, compras y pedidos. No es
un límite inferior de todo el servidor: las políticas válidas existentes de
fracciones positivas siguen siendo legibles y exigibles. Normalizar cantidades
sigue siendo independiente del contrato monetario de redondeo a dos decimales.

Para un código 2x de 13 dígitos, la búsqueda lee el lector activo que emula
teclado bajo el negocio autenticado y la sede activa. Su mapa opcional de prefijos
20–29 determina peso, precio o comportamiento EAN ordinario. El cliente envía
solo el código sin procesar, por lo que no puede sobrescribir la semántica de
sede. La ausencia de mapas conserva el diseño histórico par-peso/impar-precio;
los mapas activos malformados se cierran de forma segura hacia búsqueda EAN
ordinaria, mientras la ausencia de sede activa deshabilita por completo la
interpretación incorporada. Una carga de peso requiere una unidad base explícita
de masa y se convierte desde kilogramos mediante el factor de referencia en
gramos de esa unidad antes de aplicar la política de fracciones del producto;
las coincidencias sin clasificar, sin masa o solo de empaque se rechazan de forma
segura. Los paquetes consecutivos de peso suman sus cantidades medidas.
Una carga de precio es un precio unitario de paquete completo interpretado según
el modo normal de impuestos/precios del negocio: precios iguales pueden compartir
línea, precios distintos conservan identidades independientes al suspender y
reanudar, y no se omiten ni la reaplicación del nivel del cliente ni la aprobación
exacta `sale_price_override`. Un cajero debe consumir una autorización de gerente
vinculada a la instantánea financiera completa; gerente/administrador y las
cotizaciones aceptadas creadas por gerentes conservan su autoridad existente.
Antes de que el panel exponga esa acción, la comprobación previa autenticada
vuelve a leer el catálogo de unidades del negocio o las instantáneas congeladas
de precios del borrador. Esta indicación de lectura cierra metadatos obsoletos
del renderizador, pero nunca sustituye la comprobación independiente de
finalización. Las búsquedas que no son 2x evitan leer el periférico. Los nombres
de esquemas de país comparten actualmente el diseño genérico de SKU de cinco
dígitos/carga de cinco dígitos y no certifican ninguna balanza física ni
convención nacional de etiquetas.

[ADR-0017](../architecture/0017-vertical-profiles-site-gs1.md) define estas decisiones
de perfiles, plantillas, precisión y autoridad del lector.

## Límite del servicio de restaurante

Una cuenta de restaurante es un borrador de venta con un grafo operativo
normalizado, no una segunda autoridad de pedidos o precios. Cada mesa física
tiene como máximo un servicio abierto; esa visita puede exponer varias cuentas
independientes, comensales del servicio y tiempos, rondas enviadas, líneas y
modificadores estructurados congelados por cuenta. `sales` y `sale_items` siguen
controlando dinero, impuestos, stock, pagos, sesión de caja, recibos, devoluciones
y comportamiento fiscal.

`restaurantServices.openCheck` escribe la venta y el grafo completo de restaurante
en la misma transacción `BEGIN IMMEDIATE` que stock, auditoría, intención de
sincronización, estado canónico de repetición y finalización de idempotencia. La
capacidad es un máximo, la primera cuenta establece el número de comensales y
las posteriores deben coincidir. Completar o descartar cierra la cuenta asociada;
el servicio se cierra solo después de su última cuenta abierta. Mover mesas y
dividir cuentas conserva la coherencia venta/cuenta y serializa lecturas de
autorización con escrituras. Un servicio completo no compartido puede moverse a
una mesa activa vacía conservando comensales. Una división normalizada permanece
en su mesa actual; el sistema rechaza dividir o fusionar grupos implícitamente
en lugar de copiar un número de comensales de servicio a dos visitas. La
transacción de división también redistribuye descuento de cabecera, propina y
cargo de servicio, reconstruye pagos provisionales y rechaza estados indivisibles
de fidelidad o saldo a favor. Una cuenta normalizada no puede desvincularse hacia
una etiqueta de texto libre. La liquidación verifica que cada artículo congelado
de venta tenga exactamente una línea operativa de cuenta antes de confirmar la
transición financiera.

La lectura del estado de mesas agrupa cada capa del grafo por negocio/sede y
devuelve todas las cuentas abiertas. Pedidos por voz y el POS tradicional exigen
ese estado autorizado antes de abrir otra cuenta y fallan de forma segura cuando
no está disponible. Buscar en el catálogo de mesas es un filtro literal del
servidor aplicado antes de una paginación estable; el plano administrativo lee
el catálogo activo completo y acotado por separado. Se rechaza crear o reactivar
más de 500 mesas activas por sede sin truncar una vista operativa. Los clientes
heredados que crean y luego suspenden, y la migración `0058`, normalizan solo
hechos demostrables a partir de filas ligadas a mesas aún en borrador, incluido
un borrador reanudado por un operador; no inventan comensales, tiempos, rondas
ni historial completado. La migración `0059` permite cancelar un borrador
histórico honestamente sin sesión de caja sin debilitar el requisito de sesión
para ventas completadas o anuladas. El panel de ventas suspendidas pagina todo
el conjunto recuperable y lo acota tanto por sede de sesión de caja como de mesa
física. Una sede explícita permite a un cajero asumir una cuenta normalizada
abierta allí; los borradores minoristas genéricos siguen siendo exclusivos del
propietario. Las transiciones de borrador derivan procedencia de inventario solo
de anclajes duraderos de sesión, mesa y servicio; un borrador con stock gestionado
sin sede verificable falla de forma segura en lugar de acreditar la sede
seleccionada actualmente por el operador.

Los borradores minoristas nuevos y las cuentas de restaurante reanudadas
registran actor autenticado y terminal registrada en `sales.resumed_by` y
`sales.resumed_device_id`, que admiten nulos. Suspender, completar y descartar
exigen la reclamación del actor salvo que un gerente o administrador use la
excepción auditada. Un cierre de sesión ordenado invalida todas las sesiones
del actor y estaciona todas sus reclamaciones; cambiar de personal afecta solo
la terminal actual y estaciona solo sus reclamaciones. Actualización de borrador,
auditoría, intención de sincronización y mutación de autenticación comparten una
transacción `BEGIN IMMEDIATE`. Cada dispositivo registra además su usuario
activo y una generación monótona de identidad. Las transacciones críticas de
venta revalidan esa generación y la versión de sesión JWT como escritura final
dentro de la transacción, de modo que un cambio o cierre concurrente estaciona
un comando confirmado antes o fuerza la reversión de un comando obsoleto. Ninguna
lista de ID de borradores proporcionada por el cliente cruza el límite del
renderizador o Store Hub. Los reinicios ordinarios del renderizador conservan el
espacio por propietario. Si desaparece el almacenamiento local o vence la
autenticación, la reclamación activa del actor en el servidor sigue visible como
elemento explícito de recuperación y puede vincularse de nuevo a la terminal
registrada. Un cierre remoto fallido conserva ese espacio local y la credencial
sellada de Store Hub. La recuperación nunca es un barrido global al iniciar el
proceso que pueda interrumpir otra terminal.

Recuperar un borrador del servidor siempre obtiene su instantánea actual,
incluso si esta terminal ya posee la reclamación. El servidor trata una
reclamación sin cambios como operación semánticamente nula para auditoría y
sincronización. El renderizador conserva el ID del espacio, pero sustituye sus
líneas congeladas, cliente y nivel de precio, borrando selección obsoleta e
historial de deshacer. Ser propietario nunca demuestra vigencia después de que
otra terminal divida o reasigne una cuenta de restaurante.

El registro ordinario de dispositivos es idempotente solo mientras la terminal
registrada siga perteneciendo al mismo actor activo. Un token obsoleto pero por
lo demás válido no puede reclamar una terminal después de un cambio de personal.
La transferencia deliberada de identidad usa la transacción de cambio, que
estaciona reclamaciones previas del dispositivo antes de avanzar su generación.
Cerrar sesión y rotar la contraseña eliminan todas las vinculaciones activas de
dispositivos del actor revocado y avanzan cada generación; el siguiente inicio
debe registrar explícitamente la terminal de nuevo.

Desactivar módulos y aplicar preajustes rechaza ocultar cualquier servicio de
restaurante abierto o borrador ligado a mesa, manteniendo el mismo escritor
inmediato usado para actualizar ajustes. Las rutas heredadas de ventas también
rechazan toda asignación nueva de mesa física dentro de su transacción cuando
`dine-in` está deshabilitado. Mesero móvil requiere su módulo de superficie y
`dine-in`; Pedidos por voz requiere igualmente POS Touch y `dine-in`. Tras
confirmar una reanudación, el renderizador compensa la hidratación local fallida
restaurando la suspensión original; si restaurarla también falla, advierte
explícitamente que no se debe recrear la venta.

El envío al KDS ya participa en la escritura de venta: preparación congelada,
decisiones de despacho, eventos ordenados y outbox duradero de invalidación se
confirman juntos. Las estaciones configurables por sede y el enrutamiento por
producto/categoría aplican solo a envíos futuros. Divisiones, movimientos y
anulaciones actualizan el estado operativo sin reescribir ni duplicar comida ya
enviada. CAS sobre versión observada protege transiciones de cocina; recuperación
y reenvío conservan la identidad del ticket. [ADR-0021](../architecture/0021-durable-kitchen-preparation.md)
define contratos de lectura acotada, adopción heredada y notificación al menos
una vez. Los gerentes configuran un catálogo de modificadores versionado por
sede en la UI. Los recargos de cajeros requieren una referencia exacta de
catálogo activo validada dentro de la transacción de venta; las instrucciones
libres sin precio siguen disponibles, mientras cargos personalizados y
adicionales restringidos requieren gerente o administrador. Editar y archivar
el catálogo nunca reescribe pedidos aceptados.

## Límite de reservas y cumplimiento externo

Las reservas y la logística de entregas son agregados operativos, no sistemas
alternativos de venta. La llegada retiene una mesa sin crear una venta; sentar
al cliente vincula una versión explícita de reserva dentro de la primera
transacción real de cuenta. La entrega usa un ciclo de vida estricto y versionado
y nunca cobra ni reembolsa una venta silenciosamente.
[ADR-0022](../architecture/0022-reservation-fulfillment-boundary.md) define estos límites.

La bandeja externa firmada autentica la intención de origen y elimina duplicados
de eventos/nonces de forma duradera. Una revisión explícita de precios locales
acepta después la solicitud mediante el núcleo original de ventas estacionadas.
Las solicitudes de cancelación del origen bloquean cobro y cumplimiento, pero
exigen la vía ordinaria del operador de descarte/devolución para revertir efectos
comerciales. La gestión de credenciales y las proyecciones de bandeja se limitan
a negocio/sede; los grafos permanecen solo locales.
[ADR-0023](../architecture/0023-signed-external-order-inbox.md) define contratos de
firma, clave sellada, repetición y autoridad comercial.

## Límite de búsqueda de productos

La búsqueda literal interactiva resuelve primero vías indexadas de SKU/código
de barras exactos, luego una preselección FTS5/BM25 por negocio, y usa un barrido
`LIKE` acotado solo como alternativa de compatibilidad para texto que el
tokenizador no puede representar.

La clasificación FTS usa una consulta materializada e indexada de alcance de
negocio de como máximo 65 rowids en la misma instantánea SQL que la consulta
de candidatos. Hasta 64 coincidencias, el conjunto acotado completo se ordena
con BM25 solo de texto; esto evita calcular estadísticas para la frase del
negocio con peso cero. Los conjuntos más amplios conservan el MATCH completo
acotado y nunca se truncan antes de ordenar o filtrar por negocio. Ambas vías
comprueban propiedad autorizada del producto, pertenencia a farmacia cuando se
solicita e identidad almacenada en el índice. Una identidad corrupta de la
preselección activa la consulta completa protegida en lugar de omitir una fila
y perder exhaustividad. La estrategia nunca bifurca según la cardinalidad
global de negocios ni almacena un veredicto de resultados. La proyección acotada
reutiliza como máximo 32 formas preparadas de filtros Drizzle por base, volviendo
a vincular negocio, ID y filtros en cada lectura. No almacena datos de productos
y revalida propiedad y elegibilidad actuales.

La búsqueda semántica es un reclasificador híbrido, no un segundo barrido de
catálogo. Une coincidencias exactas con una preselección FTS de tokens OR de
alta exhaustividad, recurre a candidatos por subcadena solo cuando FTS no
devuelve ninguno e impone un máximo estricto de 200 ID candidatos. Solo se
decodifican y puntúan por coseno en JavaScript las filas de ese negocio cuyo
vector almacenado usa el modelo activo de embeddings. Así, memoria y CPU por
solicitud quedan acotadas independientemente del tamaño del catálogo. La
asociación de facturas y voz conserva un cargador explícito de embeddings de
todo el negocio porque son flujos por lotes separados; las rutas interactivas
nunca deben llamarlo.

Los vectores nuevos usan el BLOB float32 portátil y versionado `PVEC`; las filas
JSON heredadas siguen siendo legibles hasta que una regeneración explícita del
catálogo las sustituya. Esto evita otra extensión nativa y reduce almacenamiento
y costo de decodificación del conjunto retenido de 200 vectores. El valor
predeterminado actual de Ollama es `embeddinggemma`, de 768 dimensiones,
seleccionado mediante el corpus; OpenAI conserva `text-embedding-3-small`.
Dimensiones iguales no implican espacios de embeddings compatibles, por lo que
cambiar de modelo exige regeneración. [ADR-0011](../architecture/0011-product-search-vectors.md)
define códec, benchmark, comparación de mercado y condición para adoptar extensiones.

## Límite de privacidad del análisis con IA

El Copiloto carga una instantánea de ventas por negocio y tiempo antes de su
primera solicitud al modelo. Su base en memoria exclusiva para el proveedor
sustituye nombres de clientes, nombres de cajeros e ID de cajeros por etiquetas
opacas locales a la solicitud **antes** de que SQL pueda calcular alias,
subcadenas, codificaciones o agregados. Todos los pasos de herramientas usan la
misma instantánea; se cierra tanto con éxito como con fallo. Las uniones limitan
además la propiedad de clientes, usuarios, sedes, sesiones de caja y productos.

La sede en el cuerpo de análisis, cuando existe, define la instantánea filtrada
y la sede a cuya cuota de Copiloto se carga; la sede seleccionada en la UI es
solo un foco de la instrucción. Una sede omitida o nula conserva análisis de
todo el negocio. Esas solicitudes comprueban la cuota de cada sede que la
instantánea puede leer y registran una fila de auditoría sin sede, sin duplicar
el costo entre sedes. Una fila correcta de todo el negocio guarda su lista de
sedes al llamar y cuenta una vez en la proyección mensual de uso de Copiloto de
cada sede listada, sin cargar retroactivamente sedes creadas después en el mes.
Las filas correctas sin sede escritas antes de existir esa lista tienen alcance
desconocido y cuentan de forma conservadora contra todas las sedes. La
conversación web selecciona explícitamente todas las sedes o la actual, borra
evidencia anterior cuando cambia la selección y descarta respuestas que terminan
después de cambiar usuario o contexto de sede.

El mismo diccionario protege valores completos coincidentes en cada mensaje de
usuario y asistente y en las etiquetas operativas de la instantánea. No es un
detector general de datos personales ni anonimización. El diccionario cubre solo
identidades de la ventana/sede de análisis seleccionada; texto arbitrario,
nombres parciales, valores incrustados, audio y documentos no se ocultan
universalmente. Otros flujos de IA tienen sus propias vías de salida. Por eso,
la capacidad heredada `privacy.piiRedaction` se informa como `false`, incluso al
leer un valor histórico almacenado `true`.

Los seudónimos conservan agrupación por valor exacto de nombre (incluidos
homónimos), agrupación por ID de cajero, NULL de clientes anónimos y valores
monetarios. No conservan orden alfabético, búsquedas parciales de nombres ni
agrupación de nombres normalizada por mayúsculas. Su espacio de nombres cambia
con cada invocación: una etiqueta antigua nunca debe identificar silenciosamente
a otra persona. La instrucción pide repetir el nombre o usar criterios agregados
cuando una conversación hace referencia a etiquetas antiguas; no es una garantía
semántica determinista. El SQL local autorizado de solo lectura conserva su
contrato con identidades y no se usa como herramienta del modelo.

La instrucción de sistema permanece estática para la caché del proveedor. El
contenido de instantáneas y los mapas de identidad no se persisten en la
auditoría de IA. Las pruebas del límite con el proveedor usan el AI SDK real
con un modelo simulado dentro del proceso e inspeccionan cada llamada
serializada al modelo, incluidas las posteriores a resultados y errores de
herramientas. No son una certificación con proveedor en vivo.

Las excepciones de proveedores de IA, SDK y SQLite analítico son diagnósticos
no confiables: los errores tRPC de cara al cliente exponen una alternativa fija
y un código estable, nunca el mensaje de excepción sin procesar ni detalles de
`cause`. Los fallos de análisis de OCR de facturas y transcripción de voz
conservan un código distinto al de fallos de transporte. La auditoría del negocio
registra código y metadatos de llamada, no texto de excepción; solo errores de
dominio construidos localmente pueden cruzar sin cambios el límite del Copiloto.
Los registros del servidor llevan solo la salida de `summarizeProviderError`
(nombre de clase de error, estado HTTP, código de transporte; el contenedor de
reintentos del AI SDK se desenvuelve hasta su última respuesta del proveedor)
más negocio, función, proveedor, modelo y código de error, nunca el objeto de
error sin procesar. Este contrato limita filtraciones secundarias a través de
respuesta del navegador, trazado centralizado de errores y registros del servidor.

Toda respuesta del Copiloto exige al menos una consulta SQL correcta de solo
lectura sobre una tabla de instantánea segura para el proveedor. La herramienta
del modelo rechaza consultas solo de constantes y CTE; el SQL local autorizado
conserva su contrato WITH separado. Se permiten hasta cinco intentos SQL del
modelo y todos los resultados correctos se devuelven en orden sin ocultar
consultas anteriores. Ningún modo muestra prosa escrita por el modelo. El modo
guiado añade solo orientación localizada y determinista de revisión; el modo de
resultados verificados muestra consultas y filas sin esa guía. El uso real de
tokens del proveedor se audita incluso cuando una respuesta incumple el requisito
SQL. Estas comprobaciones establecen un límite mínimo de origen, **no**
corrección semántica: un SELECT puede producir una constante pese a leer una
tabla, elegir la métrica equivocada u omitir registros relevantes. Los operadores
deben inspeccionar alcance SQL y columnas antes de actuar sobre cualquier cifra.

Las completaciones genéricas de IA, el chat del Copiloto, la transcripción de
voz, la extracción heredada de facturas por visión y la extracción con Textract
admiten un intento de proveedor en curso por negocio mediante una reserva SQLite
compartida, duradera y del mes calendario local, adquirida bajo `BEGIN IMMEDIATE`.
El Copiloto comprueba la cuota mensual restante de cada sede autorizada de la
instantánea en la misma transacción de escritura, justo antes del envío al
proveedor. La extracción Textract también vuelve a comprobar cuota de facturas
de la sede activa y propiedad del negocio bajo el bloqueo de escritura; las
comprobaciones previas del router solo rechazan antes. Carga, extracción y
confirmación requieren la misma sede activa. Una segunda solicitud mientras
hay una llamada en curso recibe `AI_BUDGET_BUSY` (reintenta pronto) antes de
evaluar cuotas, porque la llamada puede consumir el último cupo;
`AI_BUDGET_EXCEEDED` significa límite alcanzado o retención de una obligación
de costo desconocido. El costo estimado correcto y la liberación de reserva se
confirman con una fila de auditoría. Un fallo registra una fila clasificada por
lo que demuestra:

- un rechazo definitivo del proveedor (HTTP 400/401/403/404/422/429) o una
  conexión nunca establecida (rechazo, fallo DNS, tiempo agotado al conectar,
  rechazo de negociación TLS) es `not_incurred` y libera la retención;
- un fallo de llamada al modelo Ollama es `local_zero` y libera la retención;
- cualquier otro fallo remoto (5xx, reinicio tras enviar la solicitud, nuestro
  límite de 60 s, resultado sin precio calculable o malformado) es `unknown`
  y conserva una retención de obligación limitada al mes.

Cancelar desde el cliente solo cancela trabajo aún no enviado. Los procedimientos
de chat del Copiloto, prueba de conexión, transcripción de voz, facturas por visión
heredada y facturas Textract pasan la señal de solicitud tRPC (abortada cuando
la respuesta HTTP cierra antes de contestar el procedimiento; los llamadores
directos pueden omitirla) al servicio como control de admisión; detiene la
solicitud antes de admitirla, sin fila de auditoría ni retención, pero nunca
alcanza una llamada ya enviada, que continúa hasta su plazo acotado y liquida su
costo conocido sin convertirlo en obligación desconocida. Los reintentos
implícitos del SDK están deshabilitados en estas vías. La transcripción de voz
calcula precio según la duración devuelta del audio; la ausencia de duración o
fila de precios no se trata como transcripción gratis. Audio enviado sin
transcripción de vuelta (`NoTranscriptGeneratedError`, por ejemplo silencio)
se procesó y facturó por minuto de audio: se liquida como `estimated` según la
duración que informó el proveedor antes de que el SDK rechazara el texto vacío,
nunca como obligación desconocida; si no informó duración se retiene como
desconocida. El Copiloto también registra uso tarifado del proveedor al rechazar
una respuesta sin SQL validado, conserva en auditoría el alcance de sedes al
llamar y trata un rechazo definitivo como no incurrido solo si ningún paso
anterior del ciclo de herramientas había devuelto una respuesta. Es un **control
de admisión local** conservador, no un tope exacto de facturación en USD: una
sola llamada puede exceder el presupuesto restante y otras entradas de IA adoptan
la reserva por separado. Las obligaciones desconocidas nunca se declaran gratis
automáticamente: un administrador registra el importe facturado por el proveedor
con `ai.reconcileBudgetHold({ costUsd, note })` (tarjeta de ajustes de IA), que
marca las filas desconocidas del mes como `estimated`, libera la retención y
escribe una fila `ai.budget_hold.reconciled` en la cadena de auditoría del negocio.
Una admisión activa en curso nunca se libera. Una admisión `pending` de más de
10 minutos (cada envío se limita a 60 s) quedó huérfana por fallo o reinicio;
la siguiente admisión o conciliación la convierte en obligación `unknown`
visible con una fila de auditoría `budgetHoldRecovery`, sin dejarla «en curso»
para siempre. Los fallos de hooks de preparación ocurren antes de enviar y se
sanean sin crear llamada ni obligación. Contadores remotos malformados de tokens
no sirven de evidencia tarifaria: los válidos siguen auditables, los inválidos
guardan cero solo junto con costo desconocido y retención conservada. Una reserva
permanece en su mes original tras reinicio o cambio de mes; admitir un mes
posterior no concilia ni prueba que la llamada previa fuera gratis. La extracción
heredada de facturas por visión liquida uso tarifado por tokens como el pipeline
de completaciones; una llamada local de visión Ollama liquida `local_zero` y
libera la retención. Textract calcula precio con `DocumentMetadata.Pages`
devuelto frente a una estimación USD por página configurada por el operador para
la región AWS exacta; faltar esa configuración bloquea el envío y la estimación
no es un estado de facturación AWS ni un tope garantizado entre niveles de precio.
Las respuestas AWS que prueban que no se procesó ninguna página (limitación,
acceso denegado, documento no compatible, parámetro inválido y otros fallos 4xx
del cliente, o credenciales que fallan antes de enviar solicitud) liberan la
retención; la falta de metadatos de páginas tras enviar conserva una obligación
desconocida. El cliente Textract hace un solo intento. Los límites mensuales
usan el calendario local del servidor, como los informes de cuota y gasto;
las zonas horarias por negocio quedan como seguimiento pendiente.

La vía síncrona de Textract conserva compatibilidad con PDF de una página,
pero analiza sus bytes localmente antes de consultar precios regionales,
reservar presupuesto y enviar al proveedor. Una comprobación previa de diez
segundos debe encontrar exactamente una página recuperable; PDF malformados,
ilegibles o de varias páginas fallan sin reserva de costo ni auditoría de
obligación desconocida. Este control no promete que Textract acepte todo PDF
sintácticamente válido ni que un fallo del proveedor sea gratis tras el envío.
JPEG y PNG no cargan el analizador PDF.

El paquete principal de Electron debe incluir el `pdf.worker.mjs` correspondiente
de PDF.js junto a su fragmento PDF generado; `build:main` analiza un fixture de
una página desde el paquete generado para que faltar el worker haga fallar CI y
empaquetado antes de publicar.

La confirmación de OCR de facturas acepta solo una auditoría de extracción
correcta vinculada al mismo negocio, sede activa, carga y hash de su contenido.
Una transacción `BEGIN IMMEDIATE` asigna el número de compra, crea borrador y
artículos, encola su intención de sincronización y añade la auditoría de
confirmación. Una reclamación única de extracción por negocio y un hash de
entradas revisadas hacen que un reintento idéntico devuelva el borrador original
sin nuevos efectos; una revisión cambiada genera conflicto. Un reintento
confirmado sigue disponible tras la retención de metadatos de auditoría de
extracción o deshabilitar la función, mientras una confirmación no confirmada
falla de forma segura si falta procedencia. El borrador persistido usa costos
netos por línea y la confirmación rechaza diferencias entre esos costos,
subtotal revisado, impuesto y total de factura. Cada línea debe llevar el
reconocimiento explícito del operador de que su costo unitario editable es neto
de impuestos. La UI refleja el subtotal redondeado de líneas netas y controles
de subtotal más IVA del escritor, permite corregir totales OCR y bloquea
confirmación hasta revisar todas las líneas. La auditoría registra que se
comprobaron costos netos; no afirma que OCR pueda determinar la base tributaria.
Textract no indica si el precio unitario de una línea incluye impuestos; una
propuesta OCR con impuestos incluidos sigue bloqueada hasta que el operador
corrija el costo unitario neto y concilie los totales de factura. No debilites
la conciliación para hacer que esa factura pase implícitamente.

## Límite de niveles de precio

Los productos exponen una cuadrícula de tres precios para su unidad base. Cada
asignación de unidad alternativa lleva sus propios `price`, `price2` y `price3`;
un nivel alternativo sin configurar se guarda como cero y resuelve al precio
de nivel 1 de esa asignación, no al precio de unidad base del producto. El
contrato compartido de niveles se usa en navegador y servidor para que la
alternativa no difiera según superficie.

Seleccionar cliente y aplicar precio son acciones deliberadamente separadas.
Seleccionar valida identidad y disponibilidad, pero nunca reescribe un carrito
o cotización abiertos. El operador debe aplicar explícitamente nivel 1, 2 o 3
en Ventas, POS Touch o el editor de cotizaciones. Completar una venta resuelve
al cliente final una vez por negocio y reutiliza ese resultado canónico para
crédito, fidelidad, persistencia y auditoría. Los clientes modernos de ventas
también envían el nivel explícito del ticket; el servidor lo congela en la
cabecera y usa esa instantánea como referencia para cambios de precio. Los
clientes heredados que omiten el campo conservan su comportamiento previo
heredando el predeterminado del cliente resuelto. El buscador global de ventas
aplica el nivel del espacio activo mediante el mismo pipeline de carrito incluso
si la página Ventas no está montada. Un precio de paquete GS1 se marca como
cambio explícito congelado, de modo que coincidir por casualidad con un nivel
de catálogo no pueda cambiarle el precio silenciosamente.

Cada artículo de venta completada congela los tres precios de catálogo
disponibles para su unidad seleccionada. Los borradores también congelan el
nivel elegido de cabecera; suspender y reanudar lo conservan, y completar rechaza
un nivel obsoleto del cliente en lugar de reclasificar precios silenciosamente.
La evaluación de cambios usa ese nivel y cuadrícula congelados, por lo que
cambiar el cliente de un borrador no puede borrar un cambio real ni fabricar
uno a partir de ediciones posteriores del catálogo. La migración `0049` rellena
borradores heredados abiertos a partir de su cliente asociado del negocio,
manteniendo el historial liquidado en el valor minorista predeterminado
conservador. Las cotizaciones guardan el nivel explícitamente seleccionado como
metadato documental junto a sus precios congelados por línea.

## Promociones y pagos con valor del cliente

Las promociones son reglas de precio controladas por el servidor, no cálculos
del renderizador. Un cobro moderno solicita una cotización autorizada y devuelve
su huella y total con el comando de venta. Completar vuelve a resolver los mismos
hechos de negocio, sede, cliente, catálogo, cantidad, ventana temporal y lote
dentro del límite de escritura; cualquier cambio rechaza el cobro sin alterar
silenciosamente su precio. Los clientes heredados que nunca solicitan una
cotización conservan su total previo sin promoción, y las cotizaciones aceptadas
conservan sus condiciones ya congeladas.

Los descuentos manuales siguen siendo el insumo de prevención de pérdidas. Las
promociones activas se aplican al valor restante de línea en orden determinista
de prioridad/especificidad, y cada regla aplicada se congela separada del
descuento efectivo de compatibilidad. Las sugerencias por vencimiento no afectan
precios hasta que un gerente convierta una explícitamente; la regla resultante
aplica solo si FEFO puede satisfacer toda la línea con su lote origen aún
vendible. Los perfiles de farmacia rechazan esa conversión.

Fidelidad y saldo a favor son métodos internos de pago de primera clase. El
servidor valora puntos enteros de fidelidad según los ajustes habilitados del
negocio, lee saldos con ese alcance y escribe pago de venta, movimiento del libro
vinculado al origen, saldo materializado, intención de sincronización y
finalización del comando en una transacción inmediata. Las devoluciones restauran
el origen exacto consumido y retiran proporcionalmente puntos ganados; las
anulaciones hacen lo mismo exactamente una vez. Una devolución legítima puede
exponer deuda de fidelidad ya gastada, pero un canje posterior o ajuste negativo
no puede aumentarla. Las exportaciones contables y el cierre diario clasifican
ambos pagos como pasivos con clientes en lugar de efectivo externo.

Los reembolsos parciales distribuyen cada nuevo importe frente a la capacidad
restante de los pagos originales, usando límites acumulados exactos en centavos
enteros. Nunca recalculan ni disminuyen una asignación de reembolso ya persistida.
Cada paso conserva su importe, respeta el saldo restante de origen y acaba
restaurando toda la mezcla original de pagos, incluidos remanentes heredados de
centavos. Repetir un comando de devolución no puede restaurar dinero ni stock
dos veces.

El cobro de borradores resuelve nombres y SKU de productos una vez tanto para
la instantánea de artículos completados como para su intención fiscal. Editar
el catálogo después de completar no cambia ninguna instantánea ni la identidad
usada en devoluciones posteriores. Esto no rellena descripciones desconocidas
de ventas históricas completadas. [ADR-0016](../architecture/0016-server-authoritative-promotions-and-customer-value.md)
define el límite completo.

## Límite de conversión de cotizaciones y cuentas por pagar a proveedores

Una cotización aceptada se convierte en venta solo mediante `sales.create`.
El renderizador puede hidratar un espacio POS dedicado, pero no alterar cliente,
sede, nivel de precio, cantidades, instantáneas de unidades, precios, descuentos,
moneda ni componentes tributarios cotizados. Las identidades de seriales
requeridas siguen siendo un insumo de cumplimiento. El servidor vuelve a leer
y verificar cada condición congelada en la misma transacción `BEGIN IMMEDIATE`
que completa la venta, avanza la cotización a `converted` e inserta la fila única
e inmutable de `quotation_sale_links`. La conversión manual sin venta no es
una transición admitida. Las líneas históricas cuya unidad base no pudo
probarse en la migración siguen siendo legibles, pero fallan de forma segura
al convertir.

El renderizador refleja ese límite en el almacén del carrito sin depender solo
de controles deshabilitados: actualizaciones genéricas, deshacer, cambios de
precio, lectores, creación rápida y buscador global de ventas no pueden modificar
espacios reanudados o respaldados por cotización. Las cotizaciones aceptadas
exponen una mutación limitada para elegir seriales físicos. Asociar un cliente
creado rápidamente se limita al espacio editable exacto que lo solicitó, por
lo que cambiar de ticket no puede asociarlo a otra venta.

Comprar inventario y deber dinero a un proveedor son hechos separados. Una
compra completada puede vincularse a una factura explícita de proveedor, pero
ninguna migración ni vía de lectura infiere deuda del historial de compras.
Los cargos viven en `provider_payable_invoices`; los importes históricos usan
el tipo explícito `opening_balance`. Pagos y créditos son orígenes inmutables
que deben asignarse por completo a facturas abiertas en su transacción de
creación. La ecuación de cuenta es, por tanto, cargos menos pagos y créditos
asignados, con antigüedad derivada de cada vencimiento congelado y no de
condiciones mutables del proveedor.

Las compras completadas se eligen mediante búsqueda acotada por negocio/proveedor
con paginación determinista y total separado. La vista general heredada sigue
siendo una vista previa limitada, no la fuente del historial seleccionable.
La selección sobrevive a cambios de página/búsqueda; crear una factura revalida
la compra atómicamente si otro operador la vinculó mientras tanto.

Cada escritura de cuenta por pagar usa el sobre de comando y confirma
atómicamente su fila, asignaciones, evento de auditoría, efectos de outbox de
sincronización y resultado canónico de repetición. Gerentes y administradores
pueden operar este libro; crear, editar, eliminar y gestionar categorías de
proveedores sigue siendo capacidad administrativa en otra ruta.
[ADR-0013](../architecture/0013-quotation-conversion-and-supplier-payables.md)
define la justificación duradera y el límite de migración.

## Límite de devoluciones y cambios normalizados

Una venta completada es inmutable. Cada devolución parcial o total es un nuevo
agregado cuya cabecera, líneas elegidas, componentes tributarios, asignaciones
a pagos originales, procedencia de lotes e identidades serializadas congelan la
evidencia usada para esa operación. El planificador resta todas las devoluciones
normalizadas previas antes de ofrecer cantidades restantes y deriva dinero
proporcional solo de las instantáneas originales mediante `roundMoney`. Nunca
vuelve a leer precios de catálogo o configuración tributaria actuales para
reescribir historia. Las filas heredadas de devolución de ticket completo
siguen legibles, pero no se inventa evidencia detallada de hijos para ellas.

El agregado debe conciliar exactamente con sus destinos congelados de pago.
El efectivo cambia el cajón actualmente abierto solo en la sede original de
venta; una porción de venta a crédito reduce el saldo del mismo cliente; los
pagos externos exigen referencia del operador. Emitir saldo a favor exige al
cliente original de venta y registra un movimiento inmutable en la cuenta de
negocio/cliente/moneda con actualización de saldo por comparación e intercambio.
El saldo a favor también es un medio de pago al cobrar bajo el contrato
compartido de pagos con valor del cliente.

Restaurar stock también se rige por evidencia. Una devolución restaura solo
cantidades exactas de lote e identidades seriales congeladas en las líneas
seleccionadas. Un cambio del modo de seguimiento del catálogo falla de forma
segura. Devolver cantidad nunca vuelve vendible un lote vencido, en cuarentena
o no vendible por otro motivo; solo un lote agotado aún válido puede activarse
de nuevo.

Un cambio es un vínculo único auditado de una devolución normalizada a una venta
de reemplazo completada independientemente. El reemplazo usa las reglas normales
de venta y, si la venta original tiene cliente, debe conservarlo. Filas de
dominio de devolución, efectos de inventario/cliente, auditoría, agregado de
sincronización versión 2, outboxes independientes de recursos mutables y
finalización del comando se confirman atómicamente. Las devoluciones con
fiscalidad habilitada también registran una intención duradera de nota de
crédito en esa transacción; un worker reiniciable la materializa junto a su
outbox de proveedor después de confirmar. Notificación en tiempo real y
presentación del diario siguen siendo efectos de mejor esfuerzo, sin entrega
con recuperación automática garantizada. La carga de sincronización es intención
local duradera, no evidencia de convergencia causal completa entre dispositivos.

[ADR-0014](../architecture/0014-normalized-sale-returns-and-store-credit.md)
define este límite y sus reglas de compatibilidad.

## Límite de impuestos normalizados por línea

Productos, artículos de venta, artículos de cotización y artículos de documentos
fiscales pueden llevar entre uno y cuatro componentes tributarios ordenados y
únicos. Las definiciones de catálogo guardan tipo (`iva` o `inc`), tasa y clave
estable; las filas hijas de venta, cotización y fiscalidad añaden importes
congelados de base gravable e impuesto redondeado. Cada fila pertenece a un
negocio. Seleccionar productos resuelve solo tasas activas de ese negocio.
Las escrituras de ventas y cotizaciones usan las definiciones almacenadas de
componentes y exigen que cualquier ID opcional de componente del cliente coincida
con su orden canónico. Un cambio numérico heredado sigue válido solo si no cambia
o coincide con una tasa activa del negocio del mismo y único tipo de impuesto;
no puede sustituir una definición multicomponente. Los clientes heredados que
omiten la matriz reciben un componente construido desde las columnas de resumen
existentes.

Las columnas antiguas `taxRate`, `taxKind`, `vatRateId` y `taxAmount` siguen
siendo un resumen compatible de lectura mientras migran los clientes: el
componente principal aporta tipo e ID de tasa, y las columnas de tasa/importe
contienen los totales combinados. La migración `0047` rellena de forma
determinista un componente para cada producto y línea histórica de venta,
cotización y fiscalidad. La asignación usa la división compartida de impuestos
incluidos/excluidos y `roundMoney`; todo residuo se asigna de forma determinista
para que los importes de componentes igualen exactamente los totales congelados
de línea y cabecera.

Crear el documento fiscal recalcula totales redondeados de IVA e INC por línea
y exige que su suma iguale la cabecera congelada de venta dentro de la misma
transacción que crea el documento, encola su outbox y avanza la numeración.
Los renderizadores de recibos expanden el token heredado de diseño `taxTotal`
en filas distintas de IVA e INC desde componentes inmutables. La creación fiscal
copia los componentes de venta a su propia instantánea en la transacción del
documento, por lo que créditos, reimpresiones, exportaciones y adaptadores de
proveedor no dependen del catálogo mutable. Para ventas completadas, esa
transacción se impulsa por una fila duradera de `fiscal_emission_intents`
creada con la venta. El worker reclama intenciones por comparación e intercambio,
recupera reclamaciones obsoletas tras salir el proceso y crea documento,
instantáneas de componentes, avance del consecutivo y outbox del proveedor en
una transacción. Las etiquetas prefieren instantáneas inmutables de nombre y
SKU del artículo vendido; solo se consulta el catálogo vivo para filas históricas
que no las tienen. La migración `0063` es aditiva y deliberadamente no inventa
intenciones para ventas históricas completadas.

Las anulaciones y devoluciones parciales normalizadas también insertan intenciones
de nota de crédito en su transacción comercial. La materialización hace
referencia al comprador, moneda y contrato fiscal originales inmutables, no a
un cliente vivo ni a un país inferido del idioma de presentación. Los proveedores
certificados/desconocidos exigen evidencia original aceptada; los proveedores
simulados/de borrador registrados pueden referirse a su borrador local ya
generado sin afirmar aceptación de la autoridad. Esperar esa evidencia original
es una dependencia de consulta periódica acotada, no un reintento transitorio
agotado. Operaciones expone inspección paginada solo de metadatos y nueva
comprobación administrativa auditada; esta conserva la carga congelada y nunca
adopta configuración de reemplazo.

El adaptador simulado de Colombia puede serializar `unitMeasureCode` congelado
como `unitCode` de cantidad UBL 2.1. Su salida se etiqueta deliberadamente como
borrador local sin firma, transmisión ni certificación. No es un proveedor,
respuesta de autoridad, artefacto de certificación ni vía de transmisión en
producción. Colombia puede conservar IVA e INC en una línea en ese borrador
local. México y Chile rechazan actualmente combinaciones que sus serializadores
de borrador no pueden representar, sin descartar silenciosamente un componente.

## Límite de vigencia de la cadena de auditoría

En Electron empaquetado, cada cadena de auditoría de negocio tiene dos autoridades
que deben coincidir: la fila SQLite `audit_chain_heads` y un sobre versionado
sellado por `safeStorage` fuera de la base de datos. El sobre externo guarda un
contador/cabecera confirmado y un conjunto ordenado de reservas pendientes.
Las escrituras auditadas reservan cada candidato que puede existir antes de la
siguiente liquidación del límite transaccional; la cabecera observada confirmada
de la base elige el prefijo válido y descarta el sufijo revertido. Una escritura
reserva el siguiente contador antes de avanzar su cabecera transaccional,
incluye ese contador en el HMAC de cabecera, avanza la cabecera de base mediante
comparación e intercambio versionado y confirma estado externo solo después de
confirmar la transacción. Recuperar al arrancar acepta solo el punto confirmado
o un candidato pendiente exacto creado alrededor de ese límite; retroceso,
desaparición o cualquier otra divergencia tras la adopción falla de forma segura.

Verificar comienza en la cabecera persistida y sigue hacia atrás el índice de
hash de cadena en páginas acotadas, seleccionando solo campos canónicos de hash.
Los recorridos grandes calculan hashes en un worker breve y ceden ejecución
entre páginas. Se comparte un verificador en curso por negocio/base y se limita
la frecuencia de inicios administrativos, pero no se guarda un veredicto de
integridad entre llamadas: cabecera, contador, versión, fecha de adopción y
número de filas se vuelven a leer antes del éxito. La supresión por privacidad
reescribe la cadena dentro de la transacción de escritura de todo o nada del
llamador usando tablas temporales, sin materializar todo el historial en
JavaScript.

Las filas creadas después de la fecha de adopción del negocio deben estar
encadenadas. Se rechaza explícitamente aplicar `audit_logs` por sincronización
remota, porque una cadena de toda la base no puede fusionar honestamente
historiales de dispositivos sin un modelo consciente de dispositivos. ADR-0012
define este límite de confianza y el razonamiento sobre estados tras fallos.
El servidor acepta un `AuditAnchorStore` opcional; un despliegue independiente
que solo aporta la clave HMAC conserva controles de vinculación, pero no debe
afirmar detección externa de retrocesos.

## Límite de seguridad de Electron

Las ventanas principal y de Pantalla del cliente usan `contextIsolation: true`,
`nodeIntegration: false` y `sandbox: true`. El renderizador no puede leer archivos,
crear procesos, abrir sockets nativos ni importar módulos Node. Sus preloads
son deliberadamente distintos: el de la pantalla pública no expone ningún puente.

Toda capacidad de escritorio sigue:

```text
renderer -> contextBridge wrapper -> ipcRenderer.invoke
         -> validated ipcMain.handle -> main-process capability
```

Los contenedores preload permanecen limitados y declarativos. Los datos del
negocio fluyen por tRPC; IPC se reserva para capacidades exclusivas de escritorio
de ciclo de vida, almacenamiento, actualizador, respaldo, impresión y
dispositivos locales.

Para sesiones autenticadas del renderizador de Electron, el proceso principal
también conserva el token de acceso actualmente verificado solo en memoria.
Una recarga puede solicitarlo por el canal limitado `session.resume`; el proceso
principal lo vuelve a verificar contra la autoridad activa antes de devolverlo
y borra el singleton si venció, es obsoleto o ya no pertenece a la identidad
registrada. El token nunca se escribe en disco ni aparece en diagnósticos de sesión.

El renderizador no tiene puente de base de datos sin procesar: no se expone
`window.db` ni `window.api.db`, ni se registran manejadores `db:*` en el proceso
principal. CRUD genérico de tablas y encolado/diagnósticos directos de outbox no
pueden eludir casos de uso tRPC, roles, auditoría, sesión de caja ni invariantes
fiscales. Los métodos IPC de resumen, activación y configuración de sincronización
permanecen en un núcleo de manejadores independiente de Electron que resuelve
el negocio desde esa sesión verificada del proceso principal antes de validar
o persistir; las indicaciones de negocio del renderizador son solo entradas de
compatibilidad y nunca controlan alcance. Las escrituras de ajustes de estación
y el setter del ID de dispositivo emitido por el servidor usan la misma
primitiva de autorización. La actualización de idioma previa al inicio sigue
estructuralmente separada porque debe traducir ventana de acceso, bandeja y
actualizador antes de autenticar. El ID de dispositivo de solo lectura es
necesario para completar el inicio; las preferencias de presentación de estación
de solo lectura no contienen datos de negocio. Las pruebas Node enumeran cada
canal autenticado de sincronización y fijan esas excepciones acotadas previas
al inicio. Los fallos esperados de sesión obsoleta cruzan main/preload como sobre
cerrado de error, no como rechazo de `ipcMain.handle`; preload recrea el rechazo
del renderizador sin el contenedor interno de invocación de Electron ni un
diagnóstico de pila del proceso principal.

## Límite de actualización de escritorio

El historial de actualizaciones descargadas y la autorización de instalación
son estados separados. El historial schema-v2 puede mostrar versión completada
e identidad SHA-512 tras reiniciar, pero la acción de instalar sigue deshabilitada
hasta que electron-updater reconfirme ese mismo artefacto en el proceso actual.
La mayor versión instalada se sella independientemente con `safeStorage` y
avanza monótonamente; el cliente rechaza todo candidato del feed inferior a ese
mínimo aunque la política remota mutable lo llame reversión.

Por tanto, el appcast puede solicitar promoción escalonada, nunca una versión
inferior de emergencia. Recuperar un binario anterior es una operación de
instalador manual entregado por separado con aprobación explícita del operador
y protección de base de datos. Esta política local no prueba firma de plataforma,
un recorrido del actualizador de producción ni rechazo de versiones inferiores
en equipos representativos; siguen siendo evidencia de Gate 5.

## Sincronización y Nodo de autoridad

La base local sigue siendo la autoridad. `sync_outbox` registra trabajo de
replicación eventual y política de conflictos sin convertir la disponibilidad
de red en condición previa de una venta local. Los modos son:

- `device_local`: una instalación controla su autoridad local;
- `site_hub`: autoridad de tienda accesible por LAN;
- `hub_client`: terminal que envía comandos al hub de tienda y puede usar un
  puente local de hardware.

En modo `hub_client` de Electron, renovar autenticación es una capacidad del
proceso principal, no un flujo de cookies del renderizador. El proceso principal
hace inicio de sesión, renovación, cambio de personal y cierre contra el hub
configurado; intermedia tráfico `/api/*` del renderizador solo hacia ese destino
fijo con lista explícita de cabeceras permitidas; sella valores rotatorios de
refresh y CSRF con `safeStorage`; y persiste el sobre con permisos de archivo
solo para el propietario (`0600` cuando se admite y ACL del sistema por usuario
en Windows). El renderizador recibe solo token de acceso breve y resultados
con forma de respuesta API; nunca recibe cookies renovables ni una primitiva
general de red. El registro IPC de escritorio acepta ese token solo si coincide
exactamente con la concesión actual de la sesión hub del proceso principal,
por lo que nunca intenta validar una firma del hub remoto con el secreto del
servidor local integrado. Los clientes empaquetados exigen URL HTTPS del hub;
en desarrollo solo se permite HTTP en dirección de bucle local.

El núcleo de sincronización está implementado, pero no promete replicación
multimaestro en la nube alojada y sin conexión. La preparación pública y las
brechas operativas conocidas se enumeran en [PROJECT-STATUS.md](../PROJECT-STATUS.md).

La vía actual de envío de sincronización reconoce trabajo de la cola local, no
entrega remota. Para cada ID seleccionado de outbox, `sync.push` toma una
transacción de escritor IMMEDIATE de SQLite y vuelve a leer la fila del negocio.
Solo se procesa una fila actualmente `queued` o `retrying`; una fila eliminada
o completada se omite sin afirmar que fue procesada. Metadatos de entidad,
registro de conflicto o fallo, estado de outbox y marcador de última
sincronización correcta se confirman o revierten juntos para esa fila. Los
helpers usan sentencias síncronas en la misma conexión; la transacción no debe
contener trabajo asíncrono. El marcador no retrocede aunque lo haga el reloj.
Es atomicidad por fila, no un lote de todo o nada ni reconocimiento de un
servidor remoto, y no reactiva reclamaciones duraderas `submitting`.

El contrato v4 expone por separado restricciones de recuperación del operador:
los agregados de inventario no pueden sustituirse ni descartarse mediante JSON
arbitrario, y recuperar productos acepta solo metadatos permitidos para un
producto existente del negocio. Las capacidades de conflicto se calculan en el
servidor y se vuelven a comprobar con la evidencia original encolada dentro de
la misma transacción inmediata que resuelve y encola el reemplazo. Los incidentes
bloqueados siguen pendientes; todavía puede reintentarse la intención original
del dominio. Consulta [ADR-0005](../architecture/0005-sync-payload-contract.md).

## Arquitectura de módulos y UI

Las rutas se cargan de forma diferida y se protegen mediante autenticación, rol,
sede y estado de módulo. Servidor y web comparten el contrato de roles. TanStack
Query controla estado del servidor; Zustand o el estado de componentes controla
interacciones exclusivas del cliente. El texto visible vive en espacios de
nombres bilingües de idioma y el español usa formas latinoamericanas neutras
de `tú`.

La navegación global por teclado y las acciones de aplicación proceden de un
registro canónico de atajos con teclas, alcance, roles y ruta opcional. El
receptor, hoja de atajos según rol, indicaciones de paleta de comandos, enlaces
de navegación y `aria-keyshortcuts` consumen ese registro. Un control visible
anuncia un atajo solo si esa acción exacta es accesible actualmente; el receptor
sigue aplicando reglas de colisión de página y campos editables.

Los módulos sectoriales pueden existir sin ser parte del segmento minorista de
producción. Los inactivos no deben añadir navegación, permisos ni ruido operativo.
Los perfiles de ferretería y carnicería reutilizan esos controles, mientras sus
plantillas de catálogo siguen siendo explícitas y solo de formulario; seleccionar
perfil nunca es una migración de catálogo.

`setupReadiness.vertical` es un modelo de lectura acotado por negocio sobre el
perfil operativo elegido. Informa hechos de configuración y recuentos de catálogo
y enlaza pantallas existentes de autoservicio. Es orientativo: no bloquea el
cobro ni convierte evidencia de software en certificación legal, de hardware,
fiscal o de producción. Para un perfil configurado, si la zona horaria persistida
del negocio no es compatible, la proyección devuelve solo un elemento accionable
de atención al calendario comercial que lleva a ajustes regionales. No sustituye
otro día calendario ni informa como listos recuentos de política y autorizaciones
de farmacia dependientes de fecha hasta reparar la zona. Las nuevas excepciones
enviadas rechazan zonas con nombre no compatibles y cadenas de desfase numérico
sin más antes de persistir; sigue permitido borrar una excepción heredada inválida.

## Decisiones duraderas

Los registros de decisiones de arquitectura de [architecture/](../architecture/README.md)
definen decisiones que los cambios futuros deben conservar:

- autoridad local de tienda;
- sobre de comando;
- taxonomía de outboxes;
- política de conflictos;
- contrato de carga de sincronización;
- seguridad de datos locales;
- activación de módulos;
- modos de ejecución del Nodo de autoridad;
- almacenamiento y validación de dinero;
- evidencia de horas extra laborales;
- [condiciones laborales con vigencia](../architecture/0024-effective-employment-terms.md)
  con historial privado de compensación;
- [ausencias operativas de empleados](../architecture/0025-operational-employee-absences.md)
  y [disponibilidad con vigencia](../architecture/0026-recurring-employee-availability.md);
- [borradores recurrentes de horarios y publicación explícita](../architecture/0027-recurring-schedule-publication.md);
- [intercambios de turno de empleados ligados al consentimiento](../architecture/0028-employee-shift-exchanges.md);
- [conciliación explícita de planificación y asistencia y costo operativo regular](../architecture/0029-attendance-reconciliation-and-operational-cost.md);
- [evidencia y aprobación de prenómina en Colombia](../architecture/0030-colombia-pre-payroll-evidence.md),
  con autoridad de cálculo dentro de la transacción y límite explícito sin certificación;
- almacenamiento de vectores de búsqueda de productos y selección de modelo;
- vigencia externa de cadena de auditoría;
- conversión de cotizaciones y cuentas por pagar a proveedores;
- perfiles sectoriales, precisión operativa de cantidades y decodificación GS1
  con autoridad de sede;
- compras exactas por lote y transformaciones de inventario;
- política de farmacia, evidencia sellada, autorización profesional, retiro y
  custodia regulada de lotes;
- servicios, cuentas, comensales, rondas y modificadores normalizados de
  restaurante y su ciclo de vida respaldado por ventas.

## Referencias relacionadas

- [TRPC_ARCHITECTURE.md](../TRPC_ARCHITECTURE.md)
- [TRPC_TESTING_GUIDE.md](../TRPC_TESTING_GUIDE.md)
- [DESKTOP_RUNTIME_GUIDE.md](../DESKTOP_RUNTIME_GUIDE.md)
- [SECURITY.md](../SECURITY.md)
- [FISCAL-INTEGRATION.md](../FISCAL-INTEGRATION.md)
- [HARDWARE-POS.md](../HARDWARE-POS.md)
- [TESTING.md](../TESTING.md)

## Límite de propiedad de la instalación

`installation_setup` es un singleton local de instalación, no una entidad de
negocio ni sincronización. Su marcador de finalización se adopta para bases
históricas de negocios y nunca se reconstruye en ejecución si falta. Los nuevos
runtimes interactivos deshabilitan datos de demostración. `auth.setupStatus`
expone solo una bandera de pendiente y opciones de catálogo global de países;
nunca devuelve identificadores comerciales ni una capacidad de configuración.

El comando del primer propietario valida una capacidad efímera del proceso
antes de calcular el hash de contraseña, limita trabajo costoso y usa una
transacción inmediata para volver a comprobar que esté vacío y crear juntos
negocio, propietario, empresa, sede, configuración regional, unidad estructural,
marcador de finalización y fila de auditoría. Una reversión conserva la capacidad
para un reintento acotado. Completar correctamente o destruir el proceso la borra.
Dos conexiones concurrentes a la base no pueden reclamar ambas la propiedad.

Las reclamaciones independientes exigen el socket real de bucle local, un Origin
local y un par CSRF explícito de doble envío incluso sin cookie de renovación
existente. Electron acepta solo el marco principal de la ventana principal de
confianza y despacha el comando tRPC fijo mediante transporte de Fastify dentro
del proceso, manteniendo capacidad y material CSRF en el proceso principal.
No es un proxy HTTP genérico. Los resultados IPC seguros nunca reenvían mensajes
de excepción de transporte, SQLite o invocación nativa.

## Acompañante CSRF vinculado a sesión

Las solicitudes autenticadas con cookies usan un acompañante HMAC opaco ligado
a la familia de renovación verificada, negocio, usuario y versión de sesión.
La igualdad cookie/cabecera nunca autoriza por sí sola una sesión activa. Las
lecturas seguras reparan el acompañante de forma determinista; la rotación de
renovación lo conserva estable, mientras inicio y transferencia de personal lo
sustituyen. La revocación lo borra junto con la cookie de renovación. El hook
HTTP deja deliberadamente la clasificación de JTI obsoleto al detector existente
de repetición de renovación.

Un JWT de renovación verificado anterior a familias puede iniciar una prueba
HMAC separada y ligada a propósito mediante una lectura segura. Solo el endpoint
independiente de renovación la acepta y cambia por una nueva familia; lotes
mixtos y mutaciones comerciales la rechazan. Las credenciales inválidas o
parcialmente marcadas con familia no pueden usar esta actualización. Las sesiones
no verificables deben iniciar sesión de nuevo; no existe un modo de compatibilidad
autenticada basado solo en igualdad. La propiedad de instalación previa a
autenticar conserva su contrato separado.

El arranque de autenticación web hace su lectura segura antes de renovar. Store
Hub mantiene custodia de refresh/CSRF en el proceso principal de Electron. Tras
un rechazo CSRF explícito anterior al manejador, el proceso principal puede
reparar el acompañante mediante una lectura segura al mismo Hub y reintentar la
renovación una vez, con protección frente a cambios de identidad. Nunca reintenta
un rechazo por repetición ni un fallo ambiguo de red/servidor. Los requisitos
HTTPS del Hub permanecen iguales.
