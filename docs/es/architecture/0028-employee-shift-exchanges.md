# Intercambios de turnos de empleados sujetos a consentimiento

**Idioma:** Español · [English](../../architecture/0028-employee-shift-exchanges.md)

Estado: Aceptado

## Decisión

Un intercambio de turnos de empleados es un flujo de consentimiento sobre dos turnos operativos exactos ya publicados. No es una reasignación sobre el registro existente, una edición del plan recurrente, una prueba de asistencia ni un ajuste de nómina. El solicitante elige un turno futuro propio y un turno futuro elegible de otro empleado. La solicitud congela los identificadores, versiones y huellas operativas completas de ambos turnos. El destinatario debe aceptar explícitamente ese par exacto, y debe aprobarlo un gerente o administrador que no sea ninguno de los participantes. Ningún comando adapta silenciosamente el consentimiento a datos más recientes de los turnos.

Como máximo una solicitud activa puede reservar un turno. Las reservas impuestas por la base de datos impiden que A↔B y C↔A avancen al mismo tiempo. Un participante puede rechazar o cancelar antes de la aprobación; después de aceptar, el destinatario puede retirar su consentimiento. Una solicitud obsoleta o archivada solo puede liberar sus reservas después de que el control de escritura compruebe que ya no representa un intercambio activo válido.

## Límite de transacción y concurrencia

Crear, responder y decidir son operaciones críticas del sobre de comando (Command Envelope). Cada finalización revalida al actor autenticado activo, la sesión del dispositivo, el tenant, el rol y la identidad del comando. La transacción inmediata de escritura de SQLite comprueba ambas versiones y huellas congeladas, la pertenencia del empleado y la sede, los instantes canónicos futuros y las políticas de ausencia, disponibilidad y superposición. Una decisión obsoleta falla con un conflicto seguro en vez de aplicarse a datos modificados.

La aprobación cancela atómicamente los dos turnos originales y crea dos turnos de reemplazo con los empleados intercambiados. Se conservan la sede, el inicio y fin canónicos, la zona horaria comercial, el estado y las notas privadas. Los vínculos inmutables apuntan de cada original a su reemplazo y de vuelta a la solicitud aprobada. Las ocurrencias originales del plan publicado permanecen sin cambios, conservando lo que la gerencia publicó originalmente. Las escrituras de programación, la transición de la solicitud, la liberación de reservas, el evento privado, la auditoría mínima, la outbox exclusivamente local y el resultado del comando en caché se confirman o revierten juntos.

La outbox del intercambio es deliberadamente solo local. La aplicación remota permanece bloqueada hasta que un modelo de conflictos entre varios dispositivos pueda conservar los mismos invariantes de consentimiento y reservas exclusivas.

## Límite de lectura, interfaz y privacidad

Las lecturas personales devuelven solo los turnos futuros del empleado autenticado, candidatos acotados de compañeros y solicitudes en las que participa ese empleado. Las lecturas de gerentes y administradores usan una bandeja separada y acotada y no pueden usarse como directorio genérico de empleados. Las lecturas tienen alcance de tenant, paginación por clave, una ventana futura limitada a 120 días y un máximo de 50 filas por página.

Las proyecciones genéricas omiten notas de turnos, motivos, huellas, correo electrónico, PIN y remuneración. Los motivos privados de transición solo están disponibles desde un historial de eventos de carga diferida para los participantes y los gerentes autorizados. La auditoría genérica y la sincronización exclusivamente local solo contienen identificadores, estado y versión. La interfaz usa tenant, usuario y rol como claves para que un cambio de cuenta desmonte el estado privado de los modales.

Crear, aceptar y aprobar requieren una confirmación explícita del par exacto mostrado. La interfaz mantiene visibles ese par y sus versiones congeladas incluso cuando cambia la paginación de candidatos. Los fallos seguros conservan la intención intentada para corregirla, pero nunca la actualizan a una versión más reciente del servidor. El autoservicio de participantes está disponible desde el menú de usuario para todos los roles de empleado; las decisiones gerenciales permanecen en el espacio de programación sujeto a permisos.

## Migración y validación

La migración aditiva crea solicitudes privadas, reservas activas exclusivas, eventos inmutables, linaje de reemplazos y triggers de invariantes. No inventa intercambios históricos ni infiere consentimiento a partir de asignaciones existentes. Las pruebas de adopción y actualización cubren bases de datos nuevas e históricas, en texto plano y cifradas. Las regresiones cubren inversión de reservas, decisiones en competencia, versiones obsoletas, turnos modificados o archivados, sesiones revocadas, reutilización de reemplazos, reversión, repetición y contención de SQLite.

El recorrido compartido entre web y Electron con tres actores crea los empleados y turnos mediante la interfaz, solicita un intercambio, lo acepta en español, lo aprueba mediante un gerente independiente, recarga la sesión del solicitante, comprueba la privacidad de la auditoría y concilia los reemplazos, eventos, reservas y outbox contra SQLite. Electron se ejecuta con el servidor Fastify dentro del mismo proceso y una base de datos cifrada con SQLCipher. Estas comprobaciones no demuestran cumplimiento de la legislación laboral, cobertura física de macOS, corrección de nómina ni usabilidad con empleados reales.

## Consecuencias

- El consentimiento y el historial de publicación siguen siendo atribuibles y revisables.
- La aprobación cuesta más que dos actualizaciones simples, pero no puede exponer una programación parcialmente intercambiada.
- Las proyecciones acotadas y el historial privado separado reducen la divulgación accidental de datos del personal.
- Un protocolo de intercambio distribuido se aplaza deliberadamente en vez de debilitar la corrección de las escrituras sin conexión desde varios dispositivos.

## Alternativas rechazadas

- **Modificar ambos empleados asignados sobre los registros existentes:** destruye la programación publicada originalmente y puede infringir triggers de superposición a mitad de la operación.
- **Reasignación solo por el gerente:** omite el consentimiento del destinatario y no es un intercambio.
- **Aceptar automáticamente versiones más recientes:** vuelve ambiguo el consentimiento después de editar la programación.
- **Publicar notas o huellas en auditoría o sincronización genéricas:** expone detalles privados de programación sin una necesidad operativa.
