# ADR-0024: Condiciones laborales con vigencia y evidencia privada

**Idioma:** Español · [English](../../architecture/0024-effective-employment-terms.md)

Estado: Aceptado

## Contexto

El puesto, la sede y la remuneración acordada de un empleado pueden cambiar sin cambiar sus permisos de aplicación. Sobrescribir el salario actual destruye la evidencia necesaria para explicar una estimación de costos pasada. La falta de un equivalente por hora para la remuneración mensual es un dato desconocido, no cero, y no justifica inventar un divisor salarial legal.

## Decisión

### Fechas de vigencia y correcciones

Las condiciones laborales son registros explícitos pertenecientes al tenant con intervalos semiabiertos del calendario comercial: se incluye el inicio y se excluye el fin. Un fin nulo deja el intervalo abierto. Un empleado no puede tener condiciones activas superpuestas entre sedes. El registro congela su zona horaria comercial y moneda. Los puestos de trabajo no otorgan roles; los empleados con acceso de lector pueden tener asignaciones laborales.

Crear, finalizar, reemplazar y anular se ejecutan mediante el sobre de comando y una transacción inmediata de escritura de SQLite. El escritor vuelve a comprobar el administrador activo, la autoridad sobre tenant, empleado y sede, la versión y las restricciones de intervalos. La auditoría, la outbox local mínima y la finalización del comando se confirman juntas. Las protecciones de roles preceden la repetición; un límite seguro de errores también abarca los fallos de reserva/recuperación del comando.

Un reemplazo cierra el registro predecesor en el nuevo inicio y crea su sucesor para el mismo empleado, conservando el fin exclusivo original y la zona horaria. La remuneración histórica permanece sin cambios. Finalizar o anular un registro conserva eventos privados de antes/después con autor, razón e identidad de operación. Una sede archivada puede tener condiciones históricas finalizadas o anuladas, pero no puede recibir condiciones nuevas. Anular condiciones erróneas nunca elimina su evidencia ni reescribe la asistencia.

### Privacidad y transporte

Solo los administradores pueden leer la remuneración, los registros completos y el historial privado de eventos. Los gerentes reciben una proyección explícita e independiente de asignaciones, que excluye a los empleados administradores y toda remuneración, moneda, razón privada y autor. Las consultas se limitan al tenant y se validan las sedes suministradas. Las listas y el historial usan páginas acotadas por clave en lugar de filtrado ilimitado en el cliente.

La auditoría general y la outbox exclusivamente local llevan tipo de ciclo de vida, identidad, sede y versión, nunca las condiciones ni las razones privadas. La aplicación remota de contratos laborales está bloqueada. Los eventos privados son de solo adición mediante la API de comandos, y los triggers de SQLite rechazan actualizaciones o eliminaciones accidentales por otro flujo de la aplicación. Esto no afirma protección contra un atacante capaz de reemplazar el propio esquema de la base de datos. Los límites existentes de cifrado de base de datos y cadena de auditoría siguen siendo autoritativos.

### Comportamiento monetario y de interfaz

Los pagos por hora y mensuales son importes explícitos no negativos con un máximo de dos decimales. El costo operativo por hora de una remuneración mensual es opcional. Un costo desconocido permanece nulo y no puede convertirse silenciosamente en cero ni en un divisor salarial específico de un país. El estimador puro de tiempo regular no es nómina certificada ni un motor de derechos legales.

La interfaz de personal de carga diferida monta por separado los componentes privados de administrador y los seguros para gerentes, asociados a la identidad y al rol del operador. La búsqueda de empleados y el historial están paginados. Los formularios del ciclo de vida conservan la versión optimista seleccionada y congelan la moneda asociada a los importes ingresados. Una actualización fallida del contexto en segundo plano no debe desmontar un formulario con cambios; el fallo de carga inicial y el fallo de actualización son estados distintos. Las versiones obsoletas requieren una actualización explícita en lugar de una sobrescritura silenciosa.

Las tarjetas y el historial congelado muestran explícitamente dos decimales: los valores predeterminados del catálogo de monedas en ejecución podrían redondear y ocultar centavos aceptados. Los importes de la interfaz nunca cambian de etiqueta ni se convierten automáticamente cuando cambia la moneda del tenant.

## Consecuencias y alternativas

- No se infiere ningún salario ni estado laboral durante la migración o el llenado de datos históricos.
- Las lecturas independientes de asignaciones reducen la divulgación accidental frente a ocultar datos en el cliente a partir de una respuesta privilegiada única.
- Los registros con vigencia y los eventos privados requieren más almacenamiento que las columnas mutables de empleados, pero conservan la evidencia necesaria para correcciones fundamentadas.
- La auditoría general sigue siendo útil sin convertirse en una segunda base de datos de remuneraciones.
- Estos registros no son documentos laborales legales, nómina certificada ni prueba de cumplimiento normativo. Sigue siendo necesaria una revisión externa para esas afirmaciones.

## Verificación

Las pruebas de almacenamiento y actualización cubren migración aditiva, importes explícitos, superposición de intervalos, sedes archivadas, aislamiento de tenants, rechazo de mutaciones directas de eventos y reversión. Las pruebas de transporte cubren límites de roles, lecturas acotadas, proyecciones seguras, idempotencia y fallos de reserva. Las pruebas de componentes cubren entradas del ciclo de vida, versiones obsoletas, confirmación duplicada, recuperación de actualización de contexto, campos ocultos de base de remuneración, centavos, escape e historial privado. La evidencia web en vivo ejercita crear, reemplazar, finalizar, anular, cambio entre administrador/gerente y recarga sobre una base de datos SQLite aislada. Estas comprobaciones no sustituyen la calificación final de lanzamiento web/Electron.
