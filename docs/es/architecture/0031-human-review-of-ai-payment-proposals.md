# Revisión humana de propuestas de pago de IA

**Idioma:** Español · [English](../../architecture/0031-human-review-of-ai-payment-proposals.md)

Estado: Aceptado

## Contexto

Un registro del extracto de un proveedor puede coincidir con varias filas locales de la outbox de pagos por importe, canal de pago y tiempo, incluso sin una referencia exacta. Antes, la pasada de conciliación determinista trataba el desempate de un modelo como permiso para establecer una fila en `settled`. Una respuesta de modelo no es evidencia del proveedor ni autorización humana para cambiar un estado relacionado con dinero. Las importaciones de extractos también avanzan su cursor después de una pasada exitosa, por lo que una sugerencia en memoria se perdería tras un fallo o reinicio.

## Decisión

El modelo solo puede crear una **propuesta pendiente** duradera y con alcance de tenant. La propuesta guarda el registro liquidado exacto del extracto, cada candidato, la fila recomendada de la outbox, la confianza y explicación del modelo y el identificador de auditoría de la llamada a IA. Una huella canónica del registro del extracto hace idempotente la repetición exacta. Las propuestas pendientes reservan la fila seleccionada de la outbox frente a pasadas posteriores de conciliación; un índice único parcial permite como máximo una propuesta pendiente por fila de la outbox; reimportar el mismo registro del extracto no vuelve a llamar al modelo. Las propuestas rechazadas conservan la evidencia y no se reabren silenciosamente al repetir la importación.

La autoridad de revisión humana usa como clave el **tenant, el canal de pago y el identificador de transacción del proveedor**, no la huella de la fila completa. Una corrección de comisión, referencia u hora de liquidación no puede liquidar otro candidato, volver a llamar al modelo ni reemplazar la propuesta inmutable. Las identidades aprobadas no pueden liquidar dos veces; las identidades pendientes y rechazadas siguen sujetas a revisión humana. La persistencia de la propuesta comprueba esta identidad bajo un bloqueo de escritura explícito `IMMEDIATE`: una repetición exacta devuelve la propuesta guardada, mientras que una fila o selección modificada genera un conflicto. La actualización determinista de liquidación también comprueba la identidad de la propuesta dentro de su predicado `NOT EXISTS`, incluidas las propuestas insertadas después de la instantánea inicial de la pasada. La evidencia existente aporta la identidad; no se reescribe ninguna propuesta histórica ni registro del proveedor.

Solo un administrador puede aprobar o rechazar la propuesta mediante el router tRPC de pagos. La API de lectura también permite gerentes, pero la ruta actual de Operaciones expone Estado de pagos solo a administradores; el acceso de gerentes a esa página no forma parte de este cambio. La interfaz de administración muestra los importes del proveedor y del POS, monedas, referencias, identificadores de transacción, todos los candidatos, discrepancias y una advertencia de que el modelo no ha confirmado el pago. La aprobación requiere que el administrador confirme haber comprobado el registro liquidado del proveedor. Una captura de pantalla o una explicación del modelo nunca se trata como evidencia de liquidación. Los campos de importe de la propuesta, importe del candidato y comisión muestran la precisión monetaria de dos decimales del repositorio incluso para monedas cuya visualización predeterminada oculta fracciones. Esta excepción exclusiva para evidencia nunca cambia las preferencias de visualización del tenant, los importes guardados ni la serialización fiscal.

Antes de persistir una recomendación del modelo, cada candidato se vuelve a leer en una transacción de escritura de SQLite. Si un worker toma un candidato durante la latencia del modelo, u otro registro pendiente del extracto reserva la misma fila de la outbox, la importación falla y su cursor permanece sin cambios para repetirla. La coincidencia determinista también usa una actualización condicional para que un registro posterior del extracto no pueda sobrescribir una transacción existente del proveedor ni liquidar una fila con propuesta pendiente.

La aprobación vuelve a leer la propuesta y la fila seleccionada de la outbox en una transacción de escritura de SQLite. Bloquea la operación por seguridad si cambió el alcance de tenant, la recomendación, la instantánea inmutable, el identificador de transacción del proveedor, el importe, la moneda, el canal de pago, el tipo de cargo, el estado `approved` o la condición de no estar tomada por un worker. Una fila ya liquidada con el mismo identificador de transacción del proveedor también bloquea la aprobación. Una actualización de comparación e intercambio cambia solo `payment_outbox`, luego marca la propuesta como aprobada y escribe los registros de auditoría de la outbox y de la propuesta en la misma transacción. No reescribe `sale_payments` ni ventas completadas. Una repetición exacta de la misma decisión retorna sin un segundo cambio de estado ni registro de auditoría; la decisión opuesta genera un conflicto.

La ruta de propuestas cubre actualmente registros de extracto de **cargos** liquidados con un candidato aprobado que ningún worker haya tomado y un identificador de transacción del proveedor no vacío. Otros casos permanecen ambiguos para revisión manual con el proveedor, en vez de ampliar la autoridad del modelo. La obtención en vivo desde proveedores y la conexión del desempate por IA siguen siendo controles de activación separados; esta decisión no los activa.

## Consecuencias

- El operador debe revisar los registros ambiguos del extracto en vez de depender de un desempate autónomo, incluso si el modelo indica alta confianza.
- La tabla de propuestas y la evidencia sobreviven al avance del cursor del worker, al reinicio, al rechazo y a la repetición exacta de la importación.
- Una propuesta obsoleta sigue visible y requiere rechazo o un nuevo registro revisado del proveedor; el sistema nunca repara una discrepancia liquidando silenciosamente otra fila de la outbox.
- La modificación manual del estado asociado al proveedor sigue siendo una acción administrativa con autorización independiente, pero no puede convertir una propuesta de IA en una decisión automática.

## Alternativas rechazadas

- **Conservar el resultado del modelo solo en la respuesta de la pasada:** el cursor de importación avanzaría y descartaría la tarea de revisión.
- **Liquidar automáticamente por encima de un umbral de confianza:** la confianza autodeclarada no es prueba del proveedor ni una política de autorización.
- **Escribir el resultado en ventas completadas o medios de pago:** modificaría el historial contable cuando lo único que está en cuestión es la conciliación de la outbox.
- **Reintentar automáticamente una recomendación rechazada:** borraría una decisión humana y crearía llamadas facturables repetidas para el mismo registro del extracto.

## Verificación

Las pruebas en memoria del router y del comparador cubren la ausencia de liquidación por IA, la persistencia de propuestas y la repetición exacta, el aislamiento por tenant y rol, los conflictos por importe obsoleto y fila tomada, los cambios concurrentes durante la latencia del modelo, la unicidad de outbox pendiente, las correcciones de comisión, referencia y tiempo, la repetición dentro de un lote, una propuesta que llega después de la instantánea de lectura, la exclusión por bloqueo de escritura con dos conexiones, las transacciones inmutables del proveedor, la revisión idempotente, la auditoría atómica y la contabilidad de ventas sin cambios. Las pruebas de interfaz cubren la evidencia, ambos idiomas, el acceso de solo lectura para gerentes y el control explícito de aprobación. La CI de servidor y web y la revisión en un entorno en ejecución siguen siendo obligatorias antes de promover la versión.
