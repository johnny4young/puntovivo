# 0020 — Modelo de servicio y cuentas de restaurante

**Idioma:** Español · [English](../../architecture/0020-restaurant-service-check-model.md)

> Estado: Aceptado
> Fecha: 2026-09-03

## Contexto

El flujo original de restaurante reutilizaba un borrador de venta genérico y después lo suspendía en un segundo comando. Esto dejaba una ventana de interrupción entre el descuento de existencias y la visibilidad en la mesa, representaba solo un borrador conveniente por mesa en algunas superficies de lectura y no tenía una estructura persistente para una visita con varias cuentas, comensales, tiempos de preparación, rondas enviadas o modificadores con precio.

Una cuenta de restaurante sigue sujeta a las reglas habituales de venta, inventario, impuestos, pagos, sesiones de caja, recibos, devoluciones y auditoría. Crear un agregado de pedido paralelo con precios o cantidades independientes permitiría que la vista del salón divergiera de la venta que finalmente se paga.

## Decisión

### Grafo operativo respaldado por la venta

- `sales` y `sale_items` siguen siendo la autoridad financiera y de inventario. Las tablas de restaurante agregan metadatos operativos; no duplican totales, impuestos, existencias, pagos ni estado fiscal.
- Una mesa física puede tener como máximo un `restaurant_service` abierto. Un servicio representa una visita continua y puede exponer hasta 100 `restaurant_checks` abiertos simultáneamente, cada uno respaldado por exactamente un borrador de venta.
- Los comensales pertenecen al servicio, mientras que los tiempos, las rondas y las líneas operativas pertenecen a una cuenta. Una línea de cuenta referencia exactamente una partida de venta congelada y puede referenciar un comensal, un tiempo y una ronda enviada.
- Se pueden congelar hasta 20 modificadores estructurados únicos por línea. Su incremento no negativo por unidad se incluye en `sale_items.unit_price`, mientras que `restaurant_modifier_amount` conserva el incremento agregado para que la finalización del borrador pueda distinguir un modificador legítimo de una modificación de precio no autorizada.
- La proyección de mesa sin paginación se limita a 1,000 líneas abiertas y 4,000 modificadores en todo el servicio. Las cuentas nuevas se rechazan al alcanzar ese límite para impedir que un cliente autenticado haga crecer una respuesta sin límites.

### Apertura atómica y ciclo de vida

- `restaurantServices.openCheck` es el comando de apertura preferido para Voice Ordering, Mobile Waiter y los flujos tradicionales de POS vinculados a mesas. Pasa por el Command Envelope y una sola transacción de venta `BEGIN IMMEDIATE` que escribe conjuntamente la venta, las existencias, el servicio de mesa, la cuenta, los comensales, los tiempos, la ronda, los metadatos de líneas, la auditoría, la intención de sincronización, la referencia canónica de repetición y la finalización de idempotencia.
- La identidad de la mesa, la sede activa, el estado del módulo de consumo en el local, la capacidad, la cantidad establecida de invitados, los asientos de comensales activos, los límites de cuentas y proyección, y la estructura de los modificadores se vuelven a validar bajo el bloqueo de escritura. El núcleo compartido de ventas resuelve y congela los precios. La capacidad de una mesa es un máximo, no un tamaño de grupo predeterminado; cada cuenta que se une a un servicio existente debe usar su cantidad de invitados establecida.
- Completar o descartar la venta liquida o cancela su cuenta en la misma transacción de venta. El servicio se cierra solo después de cerrar su última cuenta abierta.
- Solo se permite mover una cuenta normalizada cuando es la única cuenta de su servicio y la mesa de destino no tiene borrador ni servicio abierto. El escritor mueve la propia fila de servicio junto con la mesa de la venta y conserva la identidad de los comensales en lugar de fabricar una segunda visita. Una división normalizada permanece en su mesa actual porque los comensales del servicio no se pueden dividir ni combinar sin una reasignación explícita del grupo; conserva el nivel de precios, el tiempo, la ronda, los modificadores y la identidad compatible de los comensales. Las divisiones heredadas siguen siendo legibles por el flujo de ventas existente.
- Suspender, reanudar, mover, dividir, completar y descartar serializan sus lecturas de autorización con sus escrituras para impedir que dos dispositivos publiquen evidencia de transición obsoleta o pierdan un avance de versión de sincronización.
- Cada borrador minorista nuevo y cada cuenta reanudada registran al actor autenticado y la terminal registrada como asignación persistente en el servidor. Suspender, completar y descartar exigen esa asignación al actor, salvo que un gerente o administrador use la excepción auditada existente. Cerrar sesión invalida todas las sesiones del actor y, por tanto, suspende todas sus asignaciones; cambiar de empleado rota solo la terminal actual y suspende solo las asignaciones de ese dispositivo. Ambos flujos comparten la transacción inmediata de identidad, y el cliente nunca transmite una lista privada de identificadores de borradores como metadatos de limpieza.
- Una división dentro del mismo servicio reparte proporcionalmente el descuento de encabezado, la propina y el cargo por servicio congelados, recalcula ambos totales y reemplaza las filas provisionales de pago dentro de la misma transacción. Los borradores con fidelización o crédito de tienda se rechazan porque esas referencias al libro de valor del cliente no se pueden dividir sin inventar evidencia.
- `modules.setActive` y `modules.applyPreset` rechazan desactivar `dine-in` mientras exista algún servicio abierto o borrador vinculado a mesa. La comprobación operativa y la actualización de configuración comparten la misma reserva inmediata de escritura.

### Compatibilidad y límite de lectura

- Los clientes existentes que crean y luego suspenden siguen siendo compatibles. Cuando el consumo en el local está activo, suspender un borrador heredado vinculado a una mesa crea solo la estructura normalizada que se puede demostrar a partir de la venta. La migración `0058` sigue la misma regla conservadora: adopta filas de mesas activas que aún están en estado de borrador, incluidas las filas con el indicador de suspensión desmarcado, sin inventar comensales, tiempos, rondas ni historial completado. Un borrador histórico vinculado a una mesa archivada permanece como borrador heredado que un operador autorizado puede mover o descartar; la migración nunca reactiva silenciosamente su mesa ni crea estado de servicio oculto.
- La migración `0059` permite que un borrador histórico sin sesión de caja pase a `cancelled`, y conserva la regla de almacenamiento que exige sesión de caja para ventas completadas y anuladas. Nunca inventa una asignación de caja registradora.
- La migración `0060` introduce la asignación al actor que admite valores nulos. La migración `0061` introduce su alcance opcional por dispositivo y suspende de forma conservadora todos los borradores activos heredados cuyo propietario no se pueda demostrar; conserva el historial del creador y nunca fabrica `suspendedBy`.
- `restaurantServices.getTableState` está limitado por tenant/sede y carga el grafo con consultas por lotes acotadas en lugar de una consulta por cuenta. Los catálogos de mesas exponen todas las cuentas abiertas; las listas de mesas tienen paginación determinista dentro de un máximo de 500 filas activas por sede, en lugar de truncarlas silenciosamente. La búsqueda literal por nombre se ejecuta en el servidor antes de paginar, mientras que el plano del salón usa una consulta acotada independiente para el catálogo activo completo. El campo singular de borrador heredado permanece solo como proyección de compatibilidad.
- Los roles de cajero, gerente y administrador pueden leer mesas y cuentas abiertas. La autoridad de administrador controla las mutaciones del catálogo de mesas; transferir mesas y dividir cuentas sigue requiriendo autoridad de gerente o administrador.
- Un cajero que solicita una sede explícita perteneciente al tenant puede listar, reanudar, volver a suspender y liquidar allí una cuenta normalizada abierta, aunque la haya abierto otro cajero. Los borradores minoristas genéricos siguen siendo exclusivos de su propietario. La cuenta normalizada conserva `openedBy`; el recibo y la auditoría de finalización identifican al actor que liquida.
- La interfaz bloquea la operación cuando el catálogo autoritativo de mesas o el estado del servicio está cargando o no está disponible. Nunca reemplaza una mesa desconocida por texto libre. El panel de ventas suspendidas se limita a la sede activa mediante la pertenencia de la sesión de caja y de la mesa física, y recorre mediante paginación todos los resultados del servidor; un borrador heredado sin sede solo permanece visible como caso explícito de recuperación.
- Suspender, mover de mesa, completar y descartar contrastan la procedencia de la sede con la sesión de caja persistida del borrador, la mesa física y el servicio normalizado. Una sede de destino o la sede actual de la interfaz nunca establecen el origen; los borradores con control de existencias sin evidencia persistente coherente se rechazan.
- Una vez confirmada la reanudación, la hidratación local es un límite de fallo independiente. El renderizador elimina el estado local parcial y vuelve a suspender la misma venta con su mesa/etiqueta original. Si esa compensación falla, el texto indica al operador que no vuelva a crear la venta.
- Un cambio ordenado de identidad también cierra ese límite mediante la asignación persistente. Los reinicios normales conservan el espacio de trabajo local asociado al propietario. Si falta el almacenamiento local o vence la autenticación, `sales.listDrafts` expone la asignación aún activa del actor como elemento explícito de recuperación y `sales.resume` la vuelve a vincular a la terminal registrada. Un cierre de sesión remoto fallido conserva el espacio de recuperación local y la credencial sellada de Store Hub en lugar de eliminar la única vía de regreso a las existencias reservadas. La recuperación la inicia el operador; ningún barrido global de inicio interrumpe otra terminal.
- Mobile Waiter solo se puede usar cuando `mobile-waiter` y `dine-in` están activos. Voice Ordering tiene la condición equivalente de `pos-touch` más `dine-in`.

### Límite de KDS

El hook original de compatibilidad posterior a la confirmación queda reemplazado por [ADR-0021](0021-durable-kitchen-preparation.md). El envío a cocina, la preparación inmutable, el historial de eventos y la outbox de invalidación ahora participan en el escritor de ventas. Esta decisión sobre servicio/cuentas sigue sin implicar entrega física a cocina ni certificación de hardware; el contrato de preparación persistente se define por separado.

## Consecuencias

- Una respuesta exitosa de apertura de cuenta no puede dejar existencias descontadas sin una cuenta localizable, y la repetición devuelve la venta original en lugar de abrir otra cuenta.
- Varios grupos no se combinan silenciosamente por elegir la misma mesa física. Un operador debe resolver explícitamente un conflicto de cantidad de invitados.
- Mover una mesa nunca copia la cantidad completa de invitados a dos servicios simultáneos. Las cuentas compartidas deben liquidarse o cancelarse primero, y dividir cuentas entre mesas sigue sin estar disponible hasta que la interfaz pueda capturar una reasignación explícita de comensales.
- Los totales, impuestos, fidelización, recibos, devoluciones y conciliación de caja de restaurante siguen pasando por el núcleo minorista de ventas ya validado.
- La liquidación exige una correspondencia exacta uno a uno entre partidas de venta congeladas y líneas de cuenta de restaurante; los metadatos faltantes o redirigidos bloquean la finalización.
- Los borradores de mesa existentes siguen siendo legibles, pero el historial heredado incompleto se representa como desconocido en lugar de fabricarse.
- Mobile Waiter y Voice Ordering exponen hasta veinte modificadores editables de forma independiente por línea, con cantidad y un incremento de precio no negativo por unidad. Su vista previa y su comando usan el mismo redondeo por unidad y orden de acumulación; las filas opcionales vacías no aportan nada. Los nombres duplicados bloquean el guardado en lugar de combinar filas silenciosamente. El foco de teclado sigue las adiciones/eliminaciones, y todos los controles de modificadores se deshabilitan mientras el comando está pendiente.
- Los gerentes/administradores configuran un catálogo local de la sede en `/restaurants/modifiers`. Cada entrada activa congela un nombre, un incremento unitario no negativo de dos decimales, una cantidad máxima por plato, una restricción opcional de uso exclusivo por gerentes y una versión optimista. Hay como máximo 500 entradas activas por sede; las lecturas devuelven páginas acotadas.
- Los cajeros pueden agregar instrucciones libres sin precio, pero los agregados con precio necesitan una identidad de catálogo activa del mismo tenant/sede y coincidencia exacta de nombre, precio y versión. Las entradas exclusivas para gerentes exigen al actor actual real de gerente/administrador. Los precios ad hoc de gerentes siguen siendo compatibles. La autoridad se vuelve a comprobar bajo el escritor de ventas existente después de validar la mesa; una discrepancia revierte la operación en lugar de cambiar el precio de una línea cuyos impuestos y existencias ya se calcularon.
- Los guardados de configuración usan el Command Envelope: CAS, auditoría y respuesta de repetición se confirman juntos. Los modificadores históricos obtienen procedencia que admite valores nulos, no una autorización de catálogo inventada. Archivar/editar nunca reescribe las instantáneas aceptadas; la repetición, división, liquidación, KDS y los recibos siguen usando esos valores congelados.
- El operador elimina y vuelve a seleccionar explícitamente una opción obsoleta para aceptar un precio nuevo. Ni una actualización en segundo plano ni un cambio de sede cambian los precios del carrito.

## Alternativas rechazadas

- **Mantener crear más suspender como flujo principal:** un cierre inesperado entre comandos puede descontar existencias sin que el pedido sea localizable en su mesa.
- **Crear un segundo agregado de precios/pedidos de restaurante:** duplica la autoridad de la venta y genera divergencias de conciliación al pagar y devolver.
- **Tratar una mesa como una cuenta:** no permite representar cuentas independientes ni mostrar todas las cuentas ya abiertas de un grupo.
- **Inferir comensales y rondas durante la migración:** convierte hechos históricos ausentes en evidencia operativa falsa.
- **Permitir que una cuenta normalizada se desvincule hacia texto libre:** deja el grafo de servicio apuntando a una mesa física mientras la venta indica otra cosa.
- **Afirmar persistencia de KDS a partir de un hook posterior a la confirmación:** oculta la ventana precisa de fallo que debe cerrar una outbox persistente de tickets.

## Evidencia de verificación

- `packages/server/src/__tests__/restaurant-services.test.ts`
- `packages/server/src/__tests__/restaurant-tables-router.test.ts`
- `packages/server/src/__tests__/sales-park-and-reprint.test.ts`
- `packages/server/src/__tests__/kds.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/restaurants/__tests__/VoiceOrderingScreen.test.tsx`
- `apps/web/src/features/restaurants/__tests__/RestaurantModifierEditor.test.tsx`
- `apps/web/src/features/sales/SalesModals.restaurant.test.tsx`
- `apps/web/src/features/sales/useSalesFlows.test.tsx`
- `e2e/web/restaurant-service.spec.ts`
- `e2e/electron/restaurant-service.spec.ts`
- `scripts/e2e-baseline-cleanup.test.mjs`
- migración `0058_demonic_solo.sql`
- migración `0059_slimy_silver_centurion.sql`
- migración `0060_bent_masque.sql`
- migración `0061_wakeful_jack_murdock.sql`

Las pruebas de humo en vivo de web y Electron demuestran recorridos de ida y vuelta de interfaz a tRPC y a base de datos, persistencia tras recargar, la cuenta abierta de la mesa seleccionada, liquidación, capturas y un canal de errores del cliente limpio. Las pruebas de componentes y de contrato de idioma cubren el texto EN/ES y la semántica de teclado/tacto; no implican una prueba humana bilingüe. La evidencia de enrutamiento/recuperación de cocina pertenece al límite persistente de KDS definido por separado.
