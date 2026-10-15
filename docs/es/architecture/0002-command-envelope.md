# 0002: sobre de comando

**Idioma:** Español · [English](../../architecture/0002-command-envelope.md)

> Estado: aceptada
> Fecha: 2 de mayo de 2026
> Actualizado: 15 de octubre de 2026; inventario contrastado con el contrato actual del cliente.

## Decisión

**Las mutaciones críticas requieren un sobre con `operationId`, `idempotencyKey`
y `clientCreatedAt`, más cabecera separada `x-device-id` registrada. CRUD no
crítico no lo requiere. La lista cerrada está al final de este ADR.**

Cada campo tiene un propósito:

- `operationId`: UUID v4 creado por caja por clic/intención. Correlaciona interfaz,
  tRPC, transacciones y efectos de bandeja en el diario. No es ID de venta;
  una operación puede producir varios efectos.
- `deviceId`: FK textual a `devices`, identifica terminal y se valida separadamente
  para impedir dispositivos no registrados o ajenos. Lleva usuario activo y
  generación monotónica de identidad. Cambiar empleado avanza la generación y
  estaciona borradores previos atómicamente. El registro autenticado ordinario
  solo es idempotente para el mismo actor; una sesión vieja no reasigna otra identidad.
- `idempotencyKey`: clave del cliente, o derivada de operación si no puede
  aportarla. `idempotency_keys` reserva antes de ejecutar: duplicados devuelven
  recurso cacheado tras éxito, concurrentes reciben error estructurado de
  progreso y otro payload con la misma clave produce conflicto. Éxito se conserva
  24 horas. La reserva en proceso tiene lease de recuperación de 60 segundos;
  solo el nuevo propietario de reserva puede finalizarla después.
- El hash canónico versionado liga entrada, usuario, rol, generación JWT y de
  dispositivo. La unicidad sigue por equipo: otro actor no convierte reproducción
  en segundo comando. Caché antigua sin vincular se rechaza. Cambiar contraseña
  o empleado invalida el sobre viejo, incluida respuesta cacheada. Roles preceden
  caché e identidad se verifica otra vez tras hidratar. Recuperar lease exige el mismo hash.
- `clientCreatedAt`: fecha UTC ISO 8601 de caja, usada en orden de sync y
  diagnóstico de relojes. El servidor sigue controlando `created_at` de la fila;
  `clientCreatedAt` es metadato de sync/diagnóstico, no reemplazo.

Solo es obligatorio al mutar dinero, fiscalidad, caja, stock o despacho
persistente. Lecturas, preferencias y catálogo de productos, clientes,
proveedores, unidades, IVA, plantillas o idioma no lo requieren: sus restricciones
por fila son otro contrato. El catálogo puede emitir intención de sincronización del negocio.

## Alternativas rechazadas

- **Idempotencia derivada solo del servidor:** una caja que pierde conexión
  al cobrar no puede repetir la misma operación sin una clave propia.
- **Solo traza:** sirve a logs, no evita duplicados. La traza cambia al reintentar;
  la clave idempotente permanece deliberadamente.
- **Sin sobre:** deja carreras al cobrar, suspender o anular dos veces y dificulta
  seguir un clic desde interfaz a tRPC y base sin comparar fechas.
- **Sobre en todo, incluso lecturas/CRUD:** ceremonia innecesaria; unicidad por
  fila protege catálogo sin requerir una tabla idempotente para cada operación.

## Impacto de implementación

- **Persistencia:** `idempotency_keys` guarda `tenant_id`, `device_id`,
  `idempotency_key`, `operation_kind`, `request_hash`, `status`, `result_ref`,
  `locked_at`, `completed_at`, `created_at`, `expires_at`. Índice compuesto
  `(tenant_id, device_id,
idempotency_key, operation_kind)`. Hash igual
  `request_hash` devuelve `COMMAND_IN_PROGRESS` si `status='processing'` o
  `result_ref` si `status='succeeded'`; hash diferente produce conflicto tipado.
- **Middleware tRPC:** `commandEnvelope` envuelve la lista, valida Zod, reserva
  `idempotency_keys` atómicamente y devuelve `result_ref` cacheado tras éxito.
  Servicios migrados llaman `completeInTransaction` como última escritura:
  negocio, auditoría, sync autoritativo, respuesta canónica e idempotencia
  confirman o revierten juntos. El diario sigue siendo observabilidad de mejor
  esfuerzo fuera de la transacción primaria. En el conjunto explícito migrado,
  un comando real autenticado que retorna sin finalizar falla la reserva.
  Los antiguos mantienen finalización compatible hasta mover toda su escritura;
  aplicar antes el control informaría fallo con negocio ya confirmado. Para JWT
  real se revalida `sessionVersion`, rol y generación capturada del equipo bajo
  escritor de dominio. Si gana logout/cambio de empleado, revierte el comando
  viejo; si gana comando, la transacción de identidad posterior estaciona su reserva nueva/recuperada.
- **Renderer:** `useCriticalMutation` crea un sobre por intención. Clics
  equivalentes concurrentes comparten Promise y React Query reutiliza el sobre.
  Éxito o rechazo terminal explícito lo cierra; transporte incierto, falta
  temporal segura, ocupado y en progreso lo conservan para reintento del usuario,
  evitando otro movimiento si se pierde respuesta. Caduca con las 24 horas del
  servidor y se libera al desmontar su vista. El store acotado aporta el equipo
  registrado como cabecera separada. Si `sales.resume` confirma pero falla
  hidratación local, se retira espacio parcial y compensa mediante `sales.suspend`
  con etiqueta/mesa originales. Otro fallo se muestra como estado confirmado
  incierto y bloquea recrear.
- **Primitivas reutilizadas:** `desktopSession.requireTenantId()` aporta negocio;
  el sobre agrega equipo/operación. Auditoría gana `operation_id` para unir al diario.

### Lista cerrada de comandos críticos

Se aplica exactamente a los procedimientos verificados el 15 de octubre de 2026.
Agregar uno exige ADR sustituto o modificación documentada aquí.

**Ciclo de ventas**

- `sales.create`
- `sales.completeDraft`
- `sales.suspend`
- `sales.resume`
- `sales.discardDraft`
- `sales.returnSale`
- `sales.void`
- `sales.getForReprint` (escribe contador y auditoría)
- `sales.changeTable` (transferencia de mesa por manager/admin)
- `sales.splitDraft` (división de cuenta por manager/admin)
- `restaurantServices.openCheck` (servicio de mesa y borrador atómicos)
- `restaurantModifiers.save` (CAS del catálogo de sede, auditoría e instantánea reproducible)

**Sesiones de caja**

- `cashSessions.open`
- `cashSessions.close`
- `cashSessions.recordMovement` (para `paid_in`, `paid_out`, `skim` y `replenishment`)

**Informes y certificaciones**

- `reports.dayClose.signOff` (certificación irreversible manager/admin del informe integral de día congelado)

**Inventario**

- `inventory.adjustStock`
- `inventory.createMovement` (solo ajuste manual positivo de compatibilidad; rechaza tipos de venta/compra/transferencia/devolución)
- `inventoryLots.receive`
- `inventory.createCountSession`
- `inventory.saveCountSession`
- `inventory.submitCountSession`
- `inventory.approveCountSession`
- `inventory.rejectCountSession`
- `transfers.create`
- `transfers.receive`
- `transfers.void`
- `inventoryTransformations.createRecipe`
- `inventoryTransformations.updateRecipe`
- `inventoryTransformations.execute`
- `inventoryTransformations.void`

**Reservas y pedidos externos**

- `reservations.create`
- `reservations.update`
- `reservations.advance`
- `externalOrders.createConnector`
- `externalOrders.updateConnector`
- `externalOrders.accept`
- `externalOrders.reject`
- `externalOrders.resolveCancellation`

Sentar una reserva participa en el límite original de venta de restaurante.
Aceptar un pedido también usa el límite de venta nueva, ligando un borrador
suspendido a una intención revisada bajo el mismo escritor. Reproducir credenciales
solo expone metadatos. `externalOrders.receive` firmado no es un sobre humano:
nonce, ID de evento e inmutable recibo forman otra transacción persistente de
entrada sin autorizar pago ni venta local.

**Despacho de entregas**

- `deliveryOrders.create` (cotización logística manual, no venta)
- `deliveryOrders.createFromSale` (instantánea de venta completada propia)
- `deliveryOrders.advance` (transición de versión observada; entregado y cancelado son terminales)

Estos comandos completan idempotencia en la misma transacción inmediata que
proyección, evento inmutable, auditoría y bandeja solo local. Solo se cachean
ID, estado y versión de entrega, nunca PII del destinatario. Roles y módulo
se verifican antes de reproducir caché. Desde venta, la sede sale de su caja;
se rechazan cabecera de reembolso o libro de devolución. Cancelar entrega nunca cancela ni reembolsa la venta.

**Compras**

- `purchases.create`
- `purchases.createFromOrder`
- `purchases.returnPurchase`
- `purchases.void`
- `orders.create`
- `orders.submitDraft`
- `orders.void`
- `providerPayables.createInvoice`
- `providerPayables.createOpeningBalance`
- `providerPayables.recordPayment`
- `providerPayables.recordCredit`

**Libro del cliente**

- `customerLedger.addPayment`
- `customerLedger.addAdjustment`

Ambos cambian el saldo del cliente y requieren una intención lógica retenida
para que repetir confirmación no descuente dos veces la deuda.

**Periféricos**

- `peripherals.kickCashDrawer` (despacho físico auditado)
- `peripherals.buildDrawerKickBytes` (despacho auditado del cliente Hub)

**Usuarios y seguridad**

- `users.create`
- `users.update` (cambios administrativos de identidad, incluidos `role` o `isActive`)
- `users.setStaffPin` (rotar o retirar credencial del personal)
- `auth.changePassword`

**Condiciones laborales privadas**

- `workforce.contracts.create` (condiciones explícitas del administrador)
- `workforce.contracts.end` (fin exclusivo con motivo)
- `workforce.contracts.replace` (reemplazo efectivo atómico de salario/sede)
- `workforce.contracts.void` (conservar evidencia corregida sin borrarla)

Solo administradores; completan referencia idempotente dentro de contrato,
evento y auditoría. Auditoría general, resultados y bandeja solo local llevan
IDs/versiones, nunca remuneración ni motivos. La historia privada queda en su
libro por negocio. El rol se verifica antes de reproducir. El mapeo seguro de
errores rodea sobre y resolver, cubriendo reservas/recuperación sin filtrar almacenamiento privado al diario.

**Evidencia privada de nómina**

- `workforce.payroll.profiles.create`
- `workforce.payroll.profiles.end`
- `workforce.payroll.profiles.replace`
- `workforce.payroll.profiles.void`
- `workforce.payroll.periods.create`
- `workforce.payroll.periods.close`
- `workforce.payroll.runs.create`
- `workforce.payroll.runs.recalculate`
- `workforce.payroll.runs.review`
- `workforce.payroll.runs.approve`

Solo administradores; conservan evidencia en su libro privado con proyecciones
genéricas mínimas de auditoría/bandeja/resultado. Calcular, revisar y aprobar
son pasos explícitos separados; no transmiten nómina ni autorizan a un proveedor de pagos.

**Ausencias de empleados**

- `workforce.timeOff.create` (solicitud pendiente explícita, nunca aprobación automática)
- `workforce.timeOff.advance` (aprobación, rechazo o cancelación versionados)

El rol manager/admin precede a reproducir. El escritor inmediato revalida
identidad, sede, empleado y reloj antes de confirmar solicitud, evento privado,
auditoría/bandeja local mínima y finalización juntos. Motivos/fechas no entran en
transporte genérico. Aprobación y programación aplican exclusiones recíprocas
entre sedes dentro de transacción; ninguna edita silenciosamente la otra.
Consulta [ausencias operativas](0025-operational-employee-absences.md).

**Disponibilidad recurrente**

- `workforce.availability.create` (política semanal explícita global del empleado)
- `workforce.availability.replace` (división efectiva atómica con sucesor vinculado)
- `workforce.availability.void` (retirada auditada sin editar turnos programados)

El rol manager/admin precede a reproducir. Prevalidación asíncrona acotada
comprueba horarios existentes; el escritor inmediato verifica fingerprint y
autoridad antes de persistir ambos lados del reemplazo, evidencia privada,
transporte local mínimo y comando. Franjas semanales y motivos nunca entran en
auditoría/bandeja genéricas. Consulta
[disponibilidad recurrente efectiva](0026-recurring-employee-availability.md).

**Intercambios de turnos**

- `workforce.shiftSwaps.create` (solicitud del empleado con condiciones congeladas y reservas exclusivas de turnos)
- `workforce.shiftSwaps.respond` (consentimiento de contraparte o cancelación de participante)
- `workforce.shiftSwaps.decide` (aprobación de gerente independiente con linaje de reemplazo atómico, o rechazo)

La solicitud congela las dos intenciones y versiones originales. La contraparte
debe consentir antes de aprobación por gerente o administrador independiente.
Aprobar revalida autoridad y política, cancela ambos originales y crea reemplazos
exactos bajo un escritor inmediato. Turnos, vínculos de ocurrencias publicadas
y eventos siguen inmutables. Auditoría, bandeja y resultado solo llevan ID,
versión y estado; nunca notas privadas ni fingerprints de intención.

**Planes de horarios recurrentes**

- `workforce.schedulePlans.create` (persistir intención no operativa y ocurrencias congeladas)
- `workforce.schedulePlans.regenerate` (reemplazo explícito versionado del borrador)
- `workforce.schedulePlans.discard` (conservar borrador no usado y su decisión)
- `workforce.schedulePlans.publish` (activar atómicamente todas las ocurrencias congeladas)

Un borrador no reserva tiempo. Publicar revalida intención congelada, autoridad
y política bajo escritor inmediato antes de insertar turnos, vínculos, evidencia
privada, bandeja/auditoría local mínima y una finalización. Las instantáneas previas
siguen inmutables. Nombres actuales son otra proyección por negocio, no intención
histórica. Transportes genéricos nunca llevan nombres, cuerpos de reglas ni notas.

**Asistencia**

- `employeeShifts.clockIn` (iniciar turno del empleado autenticado)
- `employeeShifts.clockOut` (cerrar turno abierto del empleado autenticado)
- `employeeShifts.breaks.start` (iniciar descanso explícito)
- `employeeShifts.breaks.end` (cerrar descanso activo del empleado autenticado)
- `employeeShifts.schedule.create` (crear turno persistente de efecto inmediato)
- `employeeShifts.schedule.update` (revisar turno programado versionado)
- `employeeShifts.schedule.cancel` (cancelar sin borrar evidencia laboral)
- `employeeShifts.attendance.corrections.create` (agregar instantánea efectiva sin reescribir evidencia cruda)
- `employeeShifts.attendance.planActual.record` (registrar o revisar decisión explícita de plan/asistencia o ausencia)

Crear, actualizar y cancelar horario finalizan dentro del escritor SQLite
inmediato con turno, auditoría y bandeja local mínima. Revalida actor, negocio,
empleado, sede y reloj del negocio antes de mutar; no hay trabajo asíncrono
mientras retiene el escritor. Cancelar verifica versión incluso si ya está
cancelado; ese no-op finaliza sin duplicar efectos. Archivar empleado/sede no
impide cancelar historia. Un empleado viewer puede ser destino, no administrador;
un gerente no programa a un administrador. Aplicación remota sigue bloqueada.
Crear turno no constituye otro flujo de borrador/publicación.

Conciliar congela el plan exacto en la primera decisión. Vincula una asistencia
admisible del mismo empleado o marca ausencia explícita después de terminar el
plan. Proyección, evento privado motivado, auditoría mínima, bandeja local y
comando confirman juntos. Transportes genéricos omiten motivos, reloj y remuneración.
Consulta [conciliación explícita y costo operativo](0029-attendance-reconciliation-and-operational-cost.md).

**Aprobaciones de gerente**

- `managerApprovals.request` (crear solicitud sensible acotada)
- `managerApprovals.decideWithPin` (aprobar/rechazar con PIN de gerente reciente)
- `managerApprovals.cancel` (retirar solicitud propia aún pendiente)

**Activación de módulos**

- `modules.setActive` (administrador activa módulo del negocio)
- `modules.applyPreset` (administrador aplica preset vertical explícito)

**Custodia farmacéutica**

- `pharmacy.createAuthorization`
- `pharmacy.revokeAuthorization`
- `pharmacy.recordEvidence`
- `pharmacy.approveEvidence`
- `pharmacy.revokeEvidence`
- `pharmacy.createRecall`
- `pharmacy.closeRecall`
- `pharmacy.transitionLot`
- `pharmacy.destroyLot`

**Prevención de pérdidas**

- `lossPrevention.updateSettings` (política auditada de autoridad de cobro por rol y horarios bloqueados)
- `lossPrevention.acknowledgeAlert` (revisión compartida de gerente de alerta determinista de prevención de pérdidas)

Procedimientos **sin** sobre: lecturas (`*.list`, `*.get`, `*.search`, `*.export`),
catálogo (`products.*`, `customers.*`, `providers.*`, `units.*`, `vatRates.*`,
`categories.*`, `locations.*`, `receiptTemplates.*`, `tenantLocale.*`), preferencias
(`ai.settings.update`, `fiscalSettings.*`), notificaciones, dashboard y consultas de auditoría.

## Mapa de implementación

- `packages/server/src/trpc/middleware/commandEnvelope.ts` valida equipos/sobres,
  reserva/reproduce, finaliza transaccionalmente, mapea bloqueos con seguridad
  y registra evidencia de diario de mejor esfuerzo.
- `packages/server/src/services/idempotency/idempotencyService.ts` controla
  reservas, TTL de caché, lease de recuperación, finalización versionada y limpieza.
- `apps/web/src/lib/useCriticalMutation.ts` controla lista tipada, vida de
  intención, unión de clics duplicados y reutilización al reintentar.
- Routers de ventas, caja, inventario, transferencias, compras, personal,
  aprobaciones, seguridad, módulos, periféricos y pérdidas usan únicamente un
  decorador `criticalCommand*Procedure`.
- El diario correlaciona intentos/errores; no sustituye transacción ni auditoría/bandeja autoritativas.
- Completar venta fiscal guarda `fiscal_emission_intents` congelado antes de
  `completeInTransaction`. Otro worker materializa documento, líneas, avance de
  consecutivo y bandeja del proveedor atómicamente. Reproducir comando es solo lectura y no recrea efectos.

## Historia de modificaciones

- 2 de mayo de 2026: base de dispositivos, idempotencia, middleware, renderer y prueba de cambio de contraseña.
- 3 de mayo: ventas, caja, inventario, transferencias y usuarios; despacho tipado,
  persistencia Electron, correlación y diario.
- 14 a 16 de julio: PIN, asistencia, descansos, horarios, aprobaciones, cierre de día, módulos y pérdidas.
- 30 de agosto: compras y finalización idempotente transaccional. Clics,
  reintentos automáticos y de usuario inciertos conservan un sobre; lease
  separado del TTL de éxito; bloqueo SQLite produce código seguro de reintento.
- 2 de septiembre: `restaurantServices.openCheck`; venta, stock, servicio/cuenta,
  auditoría, sync, respuesta e idempotencia confirman en transacción inmediata.
- 3 de septiembre: suspender, reanudar, descartar, transferir mesa, dividir
  cuenta y activar/preset finalizan en dominio; fallos posteriores de caché o
  hidratación son recuperación, no fallo de comando reintentable.
- 3 de septiembre: finalización obligatoria para JWT reales migrados, bloqueo
  de registro de dispositivo con sesión vieja e intención fiscal ligada a venta
  para no perder la obligación al salir antes de activar worker.
- 4 de septiembre: conciliación explícita; plan congelado, eventos privados,
  reservas exclusivas de asistencia, efectos locales mínimos y comando confirman juntos.
