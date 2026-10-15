# ADR-0025: Ausencias explícitas de empleados y exclusiones de programación

**Idioma:** Español · [English](../../architecture/0025-operational-employee-absences.md)

Estado: Aceptado

## Contexto

Las ausencias de empleados afectan la dotación de personal entre sedes. Tratar una solicitud pendiente como aprobación puede bloquear la programación normal, mientras que aprobar una ausencia sobre un turno existente deja silenciosamente obligaciones contradictorias. Una ausencia tampoco debe reescribir la evidencia de fichaje ni inferir derechos legales de licencia o deducciones salariales.

## Decisión

### Ciclo de vida explícito y evidencia de calendario

Un gerente o administrador registra una solicitud de vacaciones, licencia o ausencia. Las solicitudes comienzan pendientes y pueden aprobarse, rechazarse o cancelarse. Las solicitudes aprobadas pueden cancelarse; las rechazadas y canceladas son terminales. El empleado no puede aprobar su propia solicitud, incluso como administrador. Los gerentes no pueden seleccionar ni leer empleados que actualmente sean administradores. Los roles de aplicación permanecen sin cambios.

El intervalo de días completos es semiabierto: se incluye el primer día de ausencia y se excluye la fecha de regreso, con un máximo de 366 días calendario. La solicitud congela su zona horaria comercial y sus límites UTC reales. Los límites del calendario reutilizan el resolvedor de reportes, incluidas las transiciones de LATAM con una medianoche omitida. Un cambio posterior de zona del tenant nunca reinterpreta la solicitud original.

Las solicitudes pendientes y aprobadas no pueden superponerse para el mismo empleado entre sedes. Solo las solicitudes aprobadas bloquean turnos nuevos o reprogramados. La aprobación rechaza una superposición con un turno ya programado, incluso en otra sede; el operador debe resolver ese turno explícitamente. La cancelación elimina el bloqueo de programación futura, pero conserva la evidencia original de aprobación. Ninguna acción modifica la asistencia realmente fichada, la remuneración ni la evidencia pasada de costos laborales.

### Decisiones transaccionales y privacidad

Crear y avanzar usan el sobre de comando con un escritor inmediato de SQLite. El tenant activo, el rol del actor, el empleado, la sede y la autoridad del reloj comercial se comprueban otra vez bajo ese escritor. La versión y el estado actuales se comparan en el predicado de actualización. El evento privado, la auditoría mínima, la outbox exclusivamente local y la finalización del comando comparten la transacción. Una identidad estable de reintento devuelve el resultado confirmado tras una respuesta incierta; un comando nuevo no puede repetir una transición terminal. Un empleado/sede archivados aún pueden tener una solicitud histórica rechazada o cancelada, pero no pueden recibir solicitudes nuevas ni aprobaciones.

Las razones y la evidencia congelada de antes/después viven solo en la tabla privada de eventos. La auditoría genérica, la outbox y las respuestas de finalización omiten la clasificación de ausencia, fechas y explicación. La aplicación por sincronización remota está bloqueada; los puentes genéricos de tablas de Electron no exponen estas tablas. Las lecturas autorizan cada página acotada de solicitudes/historial por tenant y sede y exigen la restricción actual de rol del empleado seleccionado. Los fallos desconocidos de almacenamiento devuelven un error seguro traducido y conservan la identidad de reintento.

El historial privado es de solo adición mediante la API de comandos, y los triggers de SQLite rechazan actualizaciones o eliminaciones accidentales por otro flujo de la aplicación. No es una garantía criptográfica contra un atacante capaz de reemplazar el esquema de la base de datos; siguen aplicándose los límites existentes de base de datos cifrada y cadena de auditoría.

### Interfaz del operador

La página de programación carga de forma diferida una vista dedicada de ausencias. Los montajes asociados al rol descartan los formularios/historial privados abiertos después de un cambio de empleado. Las solicitudes y el historial están paginados; la creación usa el selector acotado de empleados y excluye los empleados administradores para los gerentes. Aprobar, rechazar y cancelar requieren cada uno una explicación nueva y conservan la versión exacta mostrada cuando comenzó la decisión. Volver a consultar no puede avanzar silenciosamente esa versión ni convertir una acción confirmada en otro envío.

La interfaz distingue el primer día incluido de la fecha de regreso excluida y advierte que no se deben incluir detalles clínicos ni adjuntos sensibles. Guardar una solicitud no la aprueba. Una confirmación de cambios sin guardar conserva los valores ingresados.

## Consecuencias y limitaciones

- La migración aditiva no fabrica ausencias, autorizaciones ni saldos de licencias.
- Las vacaciones y licencias son clasificaciones operativas, no derechos legales validados, conceptos de nómina ni diagnósticos. No se aceptan adjuntos médicos.
- Las solicitudes de autoservicio del trabajador, las licencias de parte del día y la disponibilidad recurrente necesitan capacidades y contratos de programación separados; este cambio no otorga acceso de gestión a roles de aplicación de solo lectura.
- La aprobación y la programación deben seguir usando el mismo límite de escritura de base de datos. Reemplazar estas comprobaciones por lecturas solo previas a la operación reabriría la condición de carrera.

## Verificación

Las pruebas de política pura cubren fechas inválidas, transiciones cerradas y límites de horario de verano. Las pruebas reales de router cubren aislamiento de tenants/roles, denegación de autoaprobación, conflictos entre sedes, comandos superpuestos, contención entre aprobación y programación, comprobaciones actualizadas de actor/sede/reloj, reversión en cada protección de persistencia, repetición del mismo comando y fallo de respuesta posterior a la confirmación. Las pruebas directas de SQLite rechazan reescribir o eliminar evidencia privada de eventos. Las actualizaciones históricas en texto plano y cifradas conservan la asistencia real y retienen la evidencia de aprobación/cancelación en dos arranques. Las pruebas de interfaz cubren montaje privado, paginación, entradas obligatorias, retención de versión, historial seguro contra XSS, cambios sin guardar, errores seguros y paridad de idiomas. Los recorridos compartidos de web y Electron ejercitan creación real desde la interfaz, aprobación por gerente, cancelación y recarga. La evidencia de ejecución se registra por separado; estos contratos no certifican nómina, derechos legales ni compatibilidad física de plataforma.
