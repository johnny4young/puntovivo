# ADR-0022: Límites de reservaciones y cumplimiento de entregas

**Idioma:** Español · [English](../../architecture/0022-reservation-fulfillment-boundary.md)

Estado: Aceptado

## Contexto

Las reservaciones de restaurante y la logística de entrega son agregados operativos, no sistemas de venta alternativos.

## Decisión

### Reservaciones

Las reservaciones incluyen una sede explícita, una mesa opcional, el tamaño del grupo y un intervalo planificado normalizado a UTC. La interfaz indica la zona horaria del dispositivo usada para editar ese intervalo. El intervalo es semiabierto: una reservación que termina a las 19:00 no entra en conflicto con otra que comienza a las 19:00. La creación y la reasignación comprueban mesas activas propias, capacidad y superposiciones mientras mantienen el escritor inmediato de SQLite. Las reservaciones sin asignar no ocupan capacidad.

El ciclo de vida es `booked → arrived → seated`, con alternativas terminales explícitas `cancelled` y `no_show`. Marcar una inasistencia es una decisión del operador permitida solo después del inicio planificado; no hay temporizador automático ni asistencia inferida. La cancelación y la inasistencia requieren una razón del operador. Los detalles de una reservación pueden reemplazarse usando una versión esperada; las llegadas deben cancelarse explícitamente en lugar de reasignarse silenciosamente a otro grupo.

La llegada requiere una mesa vacía. No crea una venta, reserva mercancía, cobra un depósito ni envía trabajo a cocina. Un grupo que ya llegó conserva la retención de su mesa hasta que se acomode al grupo o se cancele, incluso después del fin planificado. Las llegadas pendientes siguen visibles en la lista de reservaciones fuera del intervalo de fechas seleccionado. Las reservaciones futuras no garantizan que un servicio ocupado termine a tiempo ni pueden desalojarlo.

La primera cuenta real consume un identificador y una versión de reservación llegada seleccionados explícitamente. La coincidencia de tenant, sede, mesa y tamaño del grupo se vuelve a validar en la transacción de venta. El `serviceId` de la reservación, el evento de asignación de asiento, la evidencia de auditoría, la outbox local de operaciones y el grafo de venta se confirman juntos. No hay asociación implícita por nombre/mesa ni marcador de venta vacía. Una reservación cuyo grupo ya fue acomodado permanece como evidencia histórica después de cerrar su servicio; las correcciones financieras usan los comandos de venta existentes.

Todos los flujos de entrada a mesas exigen las retenciones por reservación, incluidos `sales.create` heredado, la posterior suspensión heredada y los cambios de mesa. La elegibilidad de ocupación actual usa el reloj real bajo el escritor, no una marca de tiempo congelada antes de las comprobaciones previas asíncronas de la venta. Los servicios abiertos existentes pueden continuar hasta liquidarse explícitamente; la programación no reescribe sus marcas de tiempo financieras.

### Entrega

Una entrega manual es explícitamente una cotización logística. Nunca crea un pago, descuento de existencias ni venta. Una entrega respaldada por una venta lee las instantáneas inmutables de líneas de venta y el total autoritativo dentro de su escritor. La pertenencia a la sede se deriva de la sesión de caja propia de la venta. El estado completado por sí solo no basta: los encabezados reembolsados o cualquier registro de devoluciones excluyen la creación y las transiciones de avance del cumplimiento. La cancelación explícita sigue siendo posible y nunca anula ni reembolsa la venta.

La cadena estricta es `accepted → preparing → dispatched → delivered`; cada estado no terminal puede pasar a cancelado como alternativa. El despacho requiere un repartidor; la cancelación requiere una razón. Cada mutación está versionada y es segura ante repeticiones. Los estados terminales no pueden reabrirse. Las filas heredadas conservan moneda/procedencia desconocidas en lugar de derivar un historial ficticio de la configuración actual del tenant.

### Evidencia y transporte

Ambos dominios escriben eventos versionados inmutables y hechos mínimos de auditoría en la misma transacción de comando, y finalizan al último la protección del Command Envelope. Los nombres de destinatarios, números de contacto, direcciones de entrega y notas libres se excluyen de la proyección de auditoría/outbox. Los endpoints operativos de lectura siguen limitados por rol, módulo, tenant y sede.

La outbox de operaciones es solo local. La aplicación remota se bloquea hasta que un códec completo del agregado pueda conservar los invariantes de programación, pertenencia, eventos y servicio/venta. Una fila de outbox no demuestra que se admita sincronización entre dispositivos.

## Consecuencias

Los cambios operativos no pueden fabricar silenciosamente evidencia financiera. Las reservaciones pueden requerir resolución explícita del operador cuando un grupo anterior permanece más tiempo de lo planificado. Estas comprobaciones protegen una sola base de datos de autoridad local; no afirman que un proveedor remoto de programación haya aceptado o conciliado la reservación.

## Alternativas rechazadas

- Crear ventas de borrador vacías al llegar: reserva falsamente una identidad comercial antes de que exista un pedido.
- Inferir el grupo por mesa o nombre de invitado: resulta ambiguo ante reintentos y ediciones superpuestas.
- Comprobar retenciones de mesa solo al suspender: la venta heredada anterior ya podría reservar existencias y encolar trabajo de cocina.
- Reutilizar una marca de tiempo fiscal congelada para la elegibilidad: las comprobaciones previas asíncronas pueden cruzar el inicio de la reservación.

## Verificación

Las suites de integración de reservaciones y servicios de restaurante ejecutan SQLite real migrado mediante tRPC, incluidos comandos duplicados, versiones en conflicto, tenants aislados, puntos de entrada heredados, relojes obsoletos de comprobaciones previas y reversión en la protección de finalización. Los recorridos web reales cubren la asignación explícita de asiento mediante Sales tradicional, Mobile Waiter y POS Touch. Las filas históricas de entrega sobreviven la actualización tanto en texto plano como con SQLCipher. La calificación completa de candidato y de Electron sigue siendo un requisito separado. Estas comprobaciones son evidencia local, no certificación de hardware ni de proveedores externos.
