# ADR-0021 — Preparación persistente de cocina

**Idioma:** Español · [English](../../architecture/0021-durable-kitchen-preparation.md)

- Estado: Aceptado
- Fecha: 2026-09-03
- Reemplaza: el límite de KDS posterior a la confirmación de ADR-0020

## Contexto

Una venta podía confirmarse antes de que se ejecutara el antiguo hook de cocina de mejor esfuerzo. Si el proceso terminaba en ese intervalo, se perdía el trabajo de preparación, y reconstruir un ticket a partir de una venta mutable podía cambiar comida que ya se estaba preparando. Las divisiones de cuentas y los cambios de mesa también necesitan cambiar la asignación de entrega sin duplicar la preparación.

## Decisión

### Un solo envío transaccional

El escritor de ventas crea el encabezado de cocina, las líneas de preparación congeladas, las decisiones de despacho, los eventos ordenados y la outbox persistente de invalidación antes de confirmar. El Command Envelope de ventas existente conserva el control de los límites de idempotencia de solicitud, auditoría y fiscalidad. No se requiere encolar en KDS después de confirmar.

Un despacho es único por tenant y partida de venta de origen, incluida una exclusión explícita. Por tanto, volver a suspender, completar, cambiar el enrutamiento o dividir una línea enviada no puede enviar esa comida dos veces. Las líneas/rondas nuevas crean tickets nuevos en lugar de reemplazar una instantánea enviada. KDS deshabilitado no inventa trabajo de cocina para las ventas habituales.

La preparación congela el nombre del producto, cantidad/unidad, nota, ronda, tiempo, etiqueta de comensal y nombres/cantidades de modificadores. Se excluyen precios, detalles de medios de pago, registros de clientes y evidencia farmacéutica. La asignación operativa, la mesa actual y el estado de preparación se almacenan por separado. Las divisiones de cuentas y los cambios de mesa actualizan esa asignación sin cambiar la preparación original ni la identidad del ticket. Una anulación se convierte en un evento inmutable y un estado terminal de línea, no en un ticket eliminado.

### Configuración y lecturas acotadas

Los gerentes/administradores configuran estaciones de la sede y reglas de producto/categoría mediante procedimientos tRPC `kds.*`. Una regla de producto prevalece sobre su categoría; si no hay reglas, se hereda la estación predeterminada `main`. La exclusión es explícita. Los destinos de estación inválidos/inactivos o ajenos se rechazan; los cambios de configuración solo afectan los envíos futuros. No se puede desactivar la estación predeterminada; el enrutamiento configurado o el trabajo pendiente también impiden la desactivación.

Todas las lecturas y escrituras están limitadas por tenant/sede. Las claves de estación son inmutables. Las actualizaciones requieren una versión observada, y reemplazar una regla también comprueba la identidad observada de la regla para impedir que eliminar/recrear evada el control de concurrencia. Las mutaciones de configuración y la auditoría comparten una transacción de escritura inmediata.

Hay como máximo 64 estaciones por sede, 200 líneas únicas por envío y 512 KiB por instantánea de preparación. La búsqueda de destinos de enrutamiento usa páginas acotadas por clave y búsqueda literal con escape. Las lecturas del tablero priorizan el trabajo pendiente y devuelven una página acotada con una advertencia explícita de truncamiento. Los tickets malformados o demasiado grandes se convierten en errores de integridad de solo lectura sin ocultar los tickets correctos.

El tablero muestra su sede activa, el orden guardado de estaciones y los nombres de estación congelados de los tickets. Tanto la cola como los metadatos de estaciones se actualizan cada 30 segundos; la actualización manual consulta ambos. SSE de pedidos acelera la invalidación de la cola, pero no es el único mecanismo de actualización. La falta de conexión o los fallos de lectura de la cola deshabilitan las mutaciones de preparación en lugar de encolar acciones sobre un estado obsoleto.

### Preparación versionada y entrega de notificaciones

Las transiciones del ticket completo y de líneas individuales requieren la generación que realmente se mostró al cocinero. La transacción inmediata valida la pertenencia y la integridad de la instantánea, realiza actualizaciones de comparación e intercambio y agrega registros de auditoría/evento/outbox de forma atómica. Las acciones concurrentes o repetidas no pueden sobrescribir silenciosamente una preparación posterior. El estado listo del ticket completo se deriva del estado de sus líneas no anuladas.

Recuperar reabre la preparación existente; reenviar crea un evento de notificación para el mismo ticket, no comida nueva. La outbox usa el núcleo compartido de toma de trabajo con protección por token de toma local de KDS alrededor de la entrega/finalización. Un trabajador acotado recupera tomas obsoletas, aísla cargas malformadas, cede la ejecución entre lotes de tenants y termina el trabajo en curso al apagarse. Solo se inicia cuando el servidor comienza a escuchar, incluido el backend integrado en el proceso principal de Electron.

La entrega de SSE es al menos una vez. Un cierre inesperado después de difundir y antes de finalizar puede repetir una invalidación, lo cual es seguro porque los clientes vuelven a leer el estado persistido. El acuse de entrega significa que el difusor local de tiempo real aceptó la invalidación, no que una pantalla física de cocina o impresora la recibió. El sondeo/reconexión del tablero sigue siendo necesario. Esto no garantiza entrega al hardware.

### Evidencia histórica

Las migraciones agregan estado normalizado y conservan los bytes existentes de `items_json` y la identidad de los tickets heredados. La adopción diferida estricta y acotada registra su origen una sola vez, sin crear una notificación nueva de cocina. La evidencia heredada inválida se conserva y se muestra como no verificada; nunca se prepara parcialmente ni se repara silenciosamente. Reiniciar/repetir no puede adoptar ni despachar dos veces una línea existente.

## Alternativas rechazadas

- Encolar después de confirmar: conserva la ventana de pérdida tras aceptar la venta.
- Reconstruir un ticket en cada edición de venta: cambia la preparación ya enviada.
- Reenviar insertando otro ticket: duplica comida en lugar de notificaciones.
- Escrituras optimistas de interfaz sin generaciones observadas: pierden el progreso concurrente.
- Tratar el acuse de SSE como entrega física: exagera la evidencia local.

## Verificación y límites

Las pruebas de backend cubren reversión del envío, despachos estables, enrutamiento, CAS de línea/encabezado, división/movimiento/anulación, instantáneas dañadas, aislamiento de tenants y recuperación del trabajador, incluida la terminación del proceso después de tomar trabajo. Las pruebas de configuración ejercitan límites de roles, búsqueda literal, paginación por clave, identidad de reemplazo y reversión de auditoría. Las pruebas de interfaz ejercitan instantáneas enriquecidas, idioma, controles sin conexión/obsoletos y permisos de configuración. Los recorridos en navegador en vivo cubren configuración, pedidos estructurados, preparación, recuperación/reenvío, conciliación con SQLite, recarga y una segunda pantalla.

Consulta [pruebas](../TESTING.md) para los recorridos ejecutables y la evidencia de calificación. Esta decisión no introduce impresoras por estación, un catálogo de modificadores creado por gerentes, reservaciones ni integraciones externas de entrega. Las pruebas físicas de cocina y la evidencia de instalación firmada/hardware por plataforma siguen siendo controles separados.
