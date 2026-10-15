# Borradores de programación recurrente y publicación atómica

**Idioma:** Español · [English](../../architecture/0027-recurring-schedule-publication.md)

Estado: Aceptado

## Decisión

Un plan recurrente es un borrador creado por un gerente, no una programación operativa, una reserva del tiempo del empleado ni una prueba de horas trabajadas. Su ciclo de vida explícito es borrador → publicado o borrador → descartado. La regeneración reemplaza únicamente las ocurrencias de un borrador y requiere un motivo operativo privado. El descarte conserva la evidencia; nunca cancela turnos. Los horarios publicados permanecen congelados y las correcciones posteriores corresponden a los turnos operativos vinculados.

El generador acepta como máximo 31 fechas de inicio, 100 reglas de empleados y 1.000 ocurrencias. El fin exclusivo limita las fechas de inicio; una ocurrencia que cruza la medianoche puede terminar al día siguiente. La cadencia de una a cuatro semanas usa un lunes ISO de referencia explícito, no una semana dependiente de la configuración regional ni la zona horaria del equipo anfitrión. El plan congela su zona horaria comercial. Se rechazan las horas inexistentes por el horario de verano; las horas locales repetidas seleccionan de forma determinista la primera ocurrencia. Cada turno se limita a 24 horas **reales**. El cliente comprueba la sintaxis, pero no debe reemplazar esta regla por horas nominales del reloj local.

## Límite de transacción y concurrencia

Crear, regenerar, descartar y publicar son comandos críticos. Una publicación tiene un sobre de comando (Command Envelope) y una transacción inmediata de escritura de SQLite para todos sus turnos, vínculos de ocurrencias, transición del plan, evento privado, registro mínimo de auditoría, outbox exclusivamente local y resultado del comando en caché. Cualquier fallo revierte toda la publicación. Un reintento con la misma identidad de comando no puede publicar dos veces.

Las comprobaciones de calendario y disponibilidad que requieren CPU se ejecutan fuera del control de escritura. La admisión compara la intención exacta congelada y el resumen completo de políticas; el control de escritura vuelve a comprobar la autoridad actual del actor, la pertenencia al tenant y la sede, la elegibilidad del empleado, la configuración regional, las ausencias, los turnos superpuestos y la vigencia de las políticas. Las transiciones con control de versión en la cláusula WHERE rechazan intenciones obsoletas en vez de adaptar silenciosamente la confirmación del operador.

La cabecera, las ocurrencias y la autorización del objetivo comparten una instantánea diferida de SQLite, incluso en la base de datos compartida de desarrollo. Los nombres actuales de empleados y sedes son una proyección mínima separada dentro de esa misma instantánea. No se copian al historial privado ni al resumen de publicación. La guarda de inserción de eventos inmutables vincula al actor tanto con el tenant como con el actor de esa transición específica del plan; una clave foránea global de usuario no es suficiente.

## Límite de interfaz y privacidad

Los gerentes solo pueden acceder a los roles de empleado que actualmente tienen permitidos; los administradores conservan su autoridad más amplia existente. El selector de empleados está acotado y no consulta el directorio de administradores ni expone correo electrónico, PIN o remuneración. Las páginas de planes usan cursores propios de cada sede, que se limpian antes de la primera consulta para otra sede. Las tarjetas de vista previa se paginan en vez de montar las 1.000 ocurrencias.

La interfaz captura la versión mostrada para regenerar, publicar o descartar, requiere una confirmación explícita de publicación, impide decisiones pendientes duplicadas o que puedan cerrarse y conserva la intención editada después de un error seguro. Los errores de lectura ocultan los detalles privados en caché. Los cambios de tenant, empleado o rol desmontan el estado local privado. Las escrituras exitosas invalidan tanto los planes como la programación operativa.

Los eventos privados del plan conservan la intención congelada y los motivos operativos. Las cargas de auditoría genérica y sincronización exclusivamente local solo contienen identificadores, estado, versión y cantidad; no deben revelar horarios ni notas de empleados. La auditoría genérica sigue siendo exclusiva de administradores. La recurrencia no otorga derechos de nómina ni derechos legales.

## Migración y validación

La migración aditiva crea planes, ocurrencias, eventos privados, índices con alcance definido y guardas de invariantes. No rellena turnos manuales con planes inventados. Las pruebas de actualización y adopción cubren bases de datos nuevas e históricas, incluido el cifrado. Las regresiones cubren versiones obsoletas, carreras de instantáneas en la base compartida, atribución del actor, cambios de disponibilidad o ausencia, superposición, reversión, repetición y contención de SQLite.

El recorrido compartido entre web y Electron ejecuta creación, regeneración, publicación explícita, rechazo de conflictos, descarte y recarga en EN/ES mediante la interfaz real. La evidencia web también concilia eventos inmutables, vínculos exactos de turnos y filas mínimas de auditoría y outbox contra SQLite. Estas pruebas no reemplazan la cobertura de versiones de macOS en equipos físicos, los pilotos con empleados ni la revisión externa de políticas laborales.
