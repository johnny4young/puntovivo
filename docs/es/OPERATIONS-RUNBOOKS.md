# Procedimientos de recuperación operativa

**Idioma:** Español · [English](../OPERATIONS-RUNBOOKS.md)

Estos procedimientos son la primera respuesta segura ante señales de
**Operaciones → Requiere atención**. Son independientes del proveedor: la
aplicación identifica al primer responsable, el objetivo de respuesta y la
superficie de recuperación sin exigir acceso a la base ni exponer datos crudos del negocio.

## Entrega externa de alertas operativas

Usa **Operaciones → Alertas externas** para conectar un receptor HTTPS público
del comerciante o de su proveedor de monitoreo. Guarda en el receptor el secreto
de firma que se muestra una sola vez y verifica `X-Puntovivo-Signature` antes de
actuar sobre un payload. El contrato completo y la política de reintentos están
en [`WEBHOOKS.md`](WEBHOOKS.md).

Si la entrega se detiene:

1. Mantén abierto el incidente subyacente y sigue el procedimiento de su área
   indicado abajo. El estado de entrega externa no determina si el incidente es real.
2. Confirma que el receptor esté activo y acepte los tipos de eventos firmados
   configurados. No rotes ni expongas el secreto en logs.
3. Revisa la evidencia acotada de HTTP/códigos de error, corrige el receptor y
   usa **Reintentar entrega** sobre un envío con fallo definitivo.
4. Marca el incidente como visto solo después de que un responsable lo acepte.
   Esto registra el reconocimiento, pero no resuelve ni oculta la condición subyacente.

Puntovivo no proporciona monitoreo atendido, equipo de guardia, SLA ni tiempo de
respuesta garantizado. El comerciante es responsable del receptor y de la cobertura de respuesta.

## Reglas operativas

1. Conserva la venta, pago, documento fiscal o instantánea antes de reintentar.
2. Concilia el estado del proveedor y el local antes de repetir un movimiento de dinero.
3. Usa la superficie de recuperación del producto; nunca edites la base cifrada.
4. Escala a soporte si el mismo elemento supera el objetivo de respuesta, un
   reintento sigue siendo definitivo, falla la integridad o hacen falta credenciales.
5. Exporta un paquete de diagnóstico con datos ocultos desde
   **Operaciones → Diagnósticos**. No envíes la base, claves de cifrado,
   credenciales ni datos crudos de clientes.

## Contrato de servicio

| Servicio                      | Primer responsable | Objetivo de respuesta | Umbral de acción                                                                 | Superficie de recuperación |
| ----------------------------- | ------------------ | --------------------: | -------------------------------------------------------------------------------- | -------------------------- |
| Sincronización                | Gerente de tienda  |                30 min | Más de 25 elementos en cola o cualquier conflicto                                | Empresa → Datos            |
| Entrega fiscal                | Gerente de tienda  |                15 min | Un fallo definitivo de bandeja                                                   | Operaciones → Fiscal       |
| Hardware de recibos           | Gerente de tienda  |                30 min | Un trabajo fallido, en reintento o con fallo definitivo                          | Operaciones → Dispositivos |
| Pagos electrónicos            | Gerente de tienda  |                15 min | Una operación rechazada, agotada por tiempo, en reintento o con fallo definitivo | Operaciones → Pagos        |
| Respaldo cifrado              | Administrador      |                60 min | Programación desactivada, instantánea fallida o ningún éxito en 30 horas         | Empresa → Datos            |
| Actualizaciones de escritorio | Administrador      |                   4 h | Error de actualización o ninguna comprobación completada en 24 horas             | Empresa → Dispositivo      |

<a id="sync-recovery"></a>

## Sincronización: conciliar y reanudar

1. Abre **Operaciones → Sincronización** para distinguir atraso de conflicto y
   usa **Resolver sincronización** para continuar en **Empresa → Datos**.
2. Si solo se supera el umbral de cola, mantén conectado el nodo de autoridad
   y permite que se vacíe la cola acotada. No borres el estado local.
3. Ante un conflicto, compara las versiones visibles y elige la resolución
   documentada en **Empresa → Datos**. Confirma que bajen los recuentos de pendientes y conflictos.
4. Escala si vuelve el conflicto, la cola crece durante 30 minutos o el nodo
   de autoridad no puede reconectarse. Adjunta el paquete de diagnóstico con datos ocultos.

<a id="fiscal-recovery"></a>

## Entrega fiscal: verificar, reintentar y conservar la venta

1. Abre **Operaciones → Fiscal** y comprueba si el documento está en
   contingencia o rechazado. La venta completada sigue siendo válida localmente.
2. Confirma conectividad y credenciales del proveedor fuera de Puntovivo antes
   de reintentar. Nunca dupliques la venta ni adelantes manualmente la numeración.
3. Reintenta una vez el documento existente desde el panel y confirma que
   avance de estado. Conserva su identidad original y trazabilidad de auditoría.
4. Escala inmediatamente si intervienen numeración, firma o validación de
   autoridad, o si el reintento sigue siendo definitivo después de 15 minutos.

<a id="device-recovery"></a>

## Hardware de recibos: probar la ruta y después reintentar

1. Abre **Operaciones → Dispositivos** e identifica el trabajo fallido de impresora o cajón.
2. Confirma alimentación, papel, conexión y la prueba del periférico registrado.
3. Ejecuta la prueba segura del periférico antes de reintentar el trabajo
   existente de la bandeja. No abras repetidamente el cajón ni dupliques recibos fiscales.
4. Escala si falla la prueba, el trabajo llega a fallo definitivo o no puedes
   restablecer un transporte admitido en 30 minutos.

<a id="payment-recovery"></a>

## Pagos electrónicos: conciliar antes de reintentar

1. Abre **Operaciones → Pagos** y compara el medio de pago con la referencia
   del proveedor y el estado de conciliación.
2. Verifica el portal o terminal del proveedor antes de reintentar. Un timeout
   no demuestra que no se haya cobrado al cliente.
3. Marca liquidado solo cuando la evidencia del proveedor coincida con importe
   y referencia locales. Reintenta solo si el proveedor confirma que no hubo un cobro completado.
4. Escala cualquier cobro ambiguo, diferencia de importe, rechazo repetido o
   elemento sin resolver después de 15 minutos. Nunca crees una venta compensatoria.

<a id="backup-recovery"></a>

## Respaldo cifrado: instantánea, bóveda y ensayo de restauración

1. Un administrador abre **Empresa → Datos** y comprueba programación local,
   última instantánea correcta, evidencia de cifrado y estado de la bóveda en la nube.
2. Si la programación está desactivada o desactualizada, crea una instantánea
   ahora. Confirma fecha/hora correcta y tamaño cifrado mayor que cero antes de probar la bóveda.
3. Ejecuta el ensayo de restauración no destructivo. Verifica integridad y
   compara recuentos del negocio sin reemplazar la base en uso.
4. Si falla la bóveda, comprueba diagnóstico normalizado del proveedor,
   endpoint, bucket, región y almacenamiento seguro de credenciales. Conserva
   la instantánea local cifrada correcta mientras recuperas la entrega remota.
5. Escala inmediatamente si falla la integridad o falta custodia de la clave.
   El ensayo de release registra el punto de recuperación de la instantánea y
   el tiempo de restauración; conserva su informe saneado con la evidencia del release.

<a id="update-rollback"></a>

## Actualizaciones de escritorio: revisar política y recuperar manualmente con aprobación

1. Un administrador abre **Empresa → Dispositivo** y registra versión instalada,
   última comprobación, modo de despliegue, versión objetivo y error de actualización.
2. Para actualizar normalmente, verifica el origen firmado del release antes
   de descargar o reiniciar. No saltes la política de despliegue.
   En Windows y Linux una actualización descargada NUNCA se aplica sola:
   ninguna verificación de firma de paquete está disponible allí, por lo que
   la aplicación espera a que un administrador pulse **Reiniciar para instalar**
   en esa misma pantalla. Revísala tras cada release; una caja que permanece
   abierta puede conservar indefinidamente una actualización descargada sin aplicar.
3. Una política remota de reversión solo informa: el cliente no reduce su
   versión mínima sellada ni instala el feed regresivo. Si se aprueba la
   recuperación de emergencia, respalda primero, obtén el instalador por un
   canal confiable separado, verifica su procedencia y ejecuta la recuperación
   manual documentada. Nunca reduzcas la versión ni reemplaces la base.
4. Tras reiniciar, verifica versión, apertura de base, inicio de sesión y una
   superficie operativa de solo lectura. Escala cualquier fallo de firma,
   migración o reinicio y conserva el estado del actualizador con datos ocultos.

<a id="lost-device-response"></a>

## Dispositivo perdido o robado: revocar primero y reemplazar después

1. Un administrador abre **Operaciones → Soporte**, elige la guía de dispositivo
   perdido y continúa a **Autoridad → Dispositivos registrados**. La aplicación
   desplaza y enfoca esa lista exacta.
2. Identifica al cliente Hub ausente por su nombre registrado, sede vinculada,
   última actividad, versión y rol de autoridad. No revoques por suposición un equipo sano.
3. Si la terminal ausente es un cliente Hub, revócala y confirma que aparezca
   revocada. El servidor invalida su versión de sesión y registra la acción
   en la auditoría inmutable.
4. Si es el nodo de autoridad o una instalación local completa, no afirmes que
   la revocación del producto pueda desactivarla ni borrarla remotamente.
   Conserva el registro y escala para rotar deliberadamente las credenciales de acceso.
5. Vincula un reemplazo solo después de contener el acceso anterior. Continúa
   vendiendo desde otro dispositivo verificado y exporta un diagnóstico con
   datos ocultos si siguen siendo inciertas la identidad o la revocación.

<a id="damaged-storage-response"></a>

## Almacenamiento local dañado: conservar, verificar y restaurar

1. Deja de usar el puesto afectado y conserva sus datos de aplicación.
   No reinstales, borres archivos ni copies manualmente la base cifrada.
2. Un administrador abre **Operaciones → Soporte** en escritorio y continúa
   a **Empresa → Datos**. La aplicación desplaza y enfoca el aviso de
   restauración y sus controles dentro de la tarjeta de respaldo cifrado.
3. Confirma la última instantánea cifrada correcta y ejecuta el ensayo no
   destructivo. No reemplaces la base en uso sin que pase la validación de
   integridad y la instantánea pertenezca al negocio previsto.
4. Usa **Restaurar respaldo** solo después de verificarlo. Los paquetes de otro
   dispositivo requieren la clave de respaldo de origen mediante la solicitud
   explícita de clave; nunca la envíes por un canal no confiable.
5. Si no hay una instantánea válida o falla la integridad, conserva el puesto,
   exporta diagnósticos con datos ocultos desde otra terminal verificada y escala a soporte.

## Evidencia de release

La cola de atención del negocio consulta cada 15 segundos y se invalida
inmediatamente cuando una recuperación de sincronización, fiscalidad, hardware
o pagos tiene éxito. Los botones identifican la siguiente operación en vez de
prometer una recuperación genérica: sincronización abre resolución de conflictos;
fiscalidad, hardware y pagos abren paneles con reintentos auditados. Los controles
de respaldo y actualización indican explícitamente que requieren escritorio
cuando Operaciones se ejecuta en un navegador.

El contrato de responsables lo verifica `scripts/check-operational-readiness.mjs`.
Falla si un servicio pierde responsable, umbral, ancla de recuperación o evidencia
exacta de ensayo ejecutable. `pnpm run rehearse:upgrade-recovery` también registra
el punto de recuperación de la instantánea cifrada y el tiempo de restauración
en un informe saneado. Consulta [Pruebas y validación de releases](TESTING.md).
