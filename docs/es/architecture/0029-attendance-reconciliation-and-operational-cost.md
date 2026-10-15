# Conciliación explícita de asistencia y costo operativo

**Idioma:** Español · [English](../../architecture/0029-attendance-reconciliation-and-operational-cost.md)

Estado: Aceptado

## Decisión

La asistencia planificada y la evidencia observada de marcaciones siguen siendo hechos inmutables separados. El sistema nunca infiere un turno asistido ni una inasistencia solo por superposición de tiempo. Un gerente o administrador autorizado registra una decisión explícita y versionada que vincula un turno programado publicado con un turno de asistencia del mismo empleado o con un resultado `no_show`. Un plan pasado sin conciliar se muestra como `needs_review`; no se convierte automáticamente en una inasistencia.

La primera decisión congela el identificador del turno programado, la versión, el empleado, la sede, los extremos UTC y la zona horaria comercial. Las revisiones posteriores solo cambian el resultado o el vínculo de asistencia. Las marcaciones originales, los descansos y las instantáneas de correcciones no se reescriben. Las lecturas aplican la corrección inmutable de asistencia más reciente y conservan el plan congelado para compararlo. Un turno de asistencia puede pertenecer como máximo a un turno planificado. Se permite evidencia de otra sede para el mismo empleado, pero se marca visiblemente como una discrepancia de sede.

## Límite de transacción, privacidad y sincronización

Registrar o revisar una decisión es una operación de gerente o administrador del sobre de comando (Command Envelope). El control de escritura inmediato de SQLite revalida la autoridad actual del actor, el tenant, la versión exacta del plan, el empleado de la asistencia, la proximidad temporal y la reserva exclusiva de asistencia. La proyección, el evento privado con su motivo, la auditoría con datos mínimos por privacidad, la outbox exclusivamente local y la finalización del comando se confirman o revierten juntos. Los planes conciliados no pueden editarse ni eliminarse después; los triggers de eventos de solo anexado e identidad de origen también protegen las rutas directas de SQLite.

Las proyecciones genéricas de listas, auditoría y outbox omiten motivos de eventos, notas de empleados, detalles de marcaciones y remuneración. La evidencia candidata corresponde al mismo empleado, se limita a 20 filas cercanas y excluye la asistencia reservada por otro plan. Las lecturas de gerentes tienen alcance de tenant, filtros por rol, paginación por clave y un límite de 31 días por solicitud. La interfaz navega en ventanas de siete días con un límite histórico de 366 días y uno futuro de 120 días; estos son límites de navegación del producto, no afirmaciones de retención. La aplicación remota de conciliaciones está bloqueada hasta que exista un modelo distribuido de propiedad para la relación exclusiva entre plan y asistencia.

## Límite del costo laboral operativo

Solo los administradores pueden solicitar la proyección regular de costo operativo. Combina asistencia que tiene en cuenta las correcciones con condiciones laborales explícitas y con vigencia definida. Cada intervalo de asistencia se recorta a la ventana semiabierta solicitada del informe antes de calcular el costo, para impedir que informes adyacentes cuenten dos veces un turno largo. El trabajo se divide en los límites de la zona horaria congelada del contrato, incluidas las transiciones de horario de verano, y la superposición de descansos se resta de cada segmento exactamente una vez. Las distintas monedas permanecen separadas.

Las condiciones faltantes, un contrato mensual sin una tarifa explícita de costeo, los límites inválidos o superpuestos y los rangos monetarios inseguros siguen visibles como tiempo no disponible o totales por moneda no disponibles. Nunca se convierten en cero, seleccionan una tarifa arbitraria, exponen un agregado parcial creíble ni hacen fallar el endpoint. La proyección no calcula recargos legales por horas extra, prestaciones, impuestos, deducciones ni nómina electrónica. No es un resultado de nómina y no puede aprobar remuneración.

## Migración y validación

La migración aditiva crea la proyección de conciliación y el registro privado de eventos con índices, claves foráneas, comprobaciones y triggers de invariantes. No inventa resultados históricos. Los arranques de bases nuevas e históricas en texto plano y con SQLCipher, los reinicios repetidos, la estabilidad de migraciones, las comprobaciones de claves foráneas y las comprobaciones de integridad deben conservar esa ausencia de relleno histórico.

Las pruebas cubren decisiones explícitas de asistencia o inasistencia, revisión, métricas que tienen en cuenta las correcciones, versiones obsoletas, inasistencias futuras, evidencia reservada, pruebas entre tenants y roles, rutas inmutables de SQLite, partición de ventanas de informes, límites de horario de verano, descansos que cruzan límites, condiciones faltantes y superpuestas, monedas mixtas, desbordamiento monetario y costeo exclusivo para administradores. Los recorridos en navegador y Electron validan el ciclo completo visible para el usuario; no demuestran cumplimiento laboral ni de nómina.

## Consecuencias

- Los supervisores deben revisar la asistencia ambigua en vez de aceptar una heurística.
- El historial congelado del plan sigue siendo atribuible aunque se corrija la evidencia de marcaciones.
- Los informes de costo pueden mostrar tiempo desconocido o un total no disponible; esto es preferible a un valor financieramente plausible pero sin respaldo.
- La relación exclusivamente local es deliberadamente conservadora hasta que la propiedad de conflictos entre varios dispositivos pueda conservar las reservas exclusivas.

## Alternativas rechazadas

- **Inferir asistencia a partir de la superposición:** puede vincular la marcación incorrecta y crear inasistencias silenciosamente cuando la evidencia llega tarde o se corrige.
- **Modificar la programación o la marcación original:** destruye los hechos independientes necesarios para auditoría, disputas y correcciones posteriores.
- **Elegir un contrato entre varios superpuestos:** convierte condiciones corruptas o no compatibles en un resultado financiero arbitrario.
- **Usar el salario mensual como divisor para obtener una tarifa horaria:** incorpora una suposición legal sin validar y hace que un costo desconocido parezca autorizado.
