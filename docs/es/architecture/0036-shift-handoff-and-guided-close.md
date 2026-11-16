# 0036: relevo de turno y cierre guiado del día

**Idioma:** Español · [English](../../architecture/0036-shift-handoff-and-guided-close.md)

> Estado: Aceptada
> Fecha: 16 de noviembre de 2026

## Contexto

Una caja cambia de manos durante el día. Hasta ahora el cajero saliente
cerraba la sesión con un conteo a ciegas y el entrante abría una nueva desde
cero: la nota, las ventas suspendidas y el propio cajón no quedaban
enlazados entre las dos sesiones. En la noche el administrador firmaba el
día sin un lugar para explicar por qué faltaba dinero en un cajón ni para
decidir qué pasa con una venta que sigue suspendida.

Los invariantes de la sesión de caja no cambian: una sesión abierta por
inquilino, sede y cajero y una por caja, la verificación dentro de la
transacción antes de que una venta se enlace a una sesión,
`insertCashMovement` avanzando el saldo esperado en el mismo paso y el
cierre a ciegas.

## Decisión

**Fila de relevo.** `cash_session_handoffs` registra un cajón que pasa de
una sesión a la siguiente: la caja, la sesión y el cajero salientes (nombre
congelado al firmar), el conteo a ciegas con denominaciones, la nota, los
ids de las ventas suspendidas que pasan y los avisos preparados para el
siguiente cajero (poco sencillo según las dos denominaciones más pequeñas
del conteo, impresiones fallidas en la sede). Las columnas de recepción
quedan en nulo hasta que alguien la recibe.

**Entregar reutiliza el cierre.** `handOutShift` llama a `closeCashSession`
con un gancho de transacción, de modo que el cierre de la sesión y la fila
de relevo se confirman juntos. El cajero saliente nunca ve el saldo
esperado; la vista previa devuelve el total y la curva del turno, nunca el
efectivo esperado.

**Recibir reutiliza la apertura.** `receiveShift` llama a `openCashSession`
con un gancho que, en la misma transacción `immediate`, reclama el relevo
con una actualización condicional (`to_session_id IS NULL`), comprueba que
la caja no se volvió a abrir después del relevo, guarda el recuento y su
diferencia frente al conteo saliente y reasigna las ventas suspendidas. La
apertura conserva todas sus precondiciones, así que un cajero con otro cajón
abierto sigue siendo rechazado. La diferencia entre los dos conteos vive
solo en la fila de relevo; el sobrante o faltante de ninguna sesión cambia.

Hay dos modos de recibir: recontar el cajón que está o traer un fondo nuevo
(el cajón anterior va a la oficina y no se guarda recuento). Un cajero con
PIN de personal confirma con él; uno sin PIN queda confirmado por la sesión
autenticada. Quien entregó el cajón no puede recibirlo.

**Propiedad de las ventas suspendidas.** Solo pasan las que siguen
suspendidas y siguen siendo del cajero saliente, con la misma regla de
propiedad que `sales.listDrafts` aplica a los cajeros (`suspended_by`, o
`created_by` cuando está vacío). Una que un administrador tomó entretanto se
queda donde está. Las cuentas de mesa nunca se mueven: cualquier cajero de
la sede ya puede tomarlas.

**Cierre guiado.** `reports.dayClose.guide` reúne lo que el administrador
necesita para firmar: el día en cifras, cajas cerradas y abiertas, cajones
con diferencia, ventas suspendidas, estado de la DIAN y anomalías de
severidad alta. Se guardan dos decisiones nuevas:

- Una tolerancia de diferencia para todo el inquilino en
  `cashCloseSettings`. Una sesión cerrada cuyo sobrante o faltante la
  supere necesita un motivo (cambio mal entregado, retiro sin registrar u
  otro con nota) guardado en la sesión. `dayClose.signOff` rechaza el día
  mientras falte uno y `operations.today` lo muestra antes del cierre.
- Una venta suspendida puede dejarse para mañana (`carried_over_at`), de
  modo que el cierre deja de preguntar por ella ese día. Descartarla sigue
  pasando por `sales.discardDraft`.

La firma es un PNG dibujado o el PIN de personal de quien firma, guardado
en `day_close_signoffs` junto a la certificación existente. Una vez firmado
el día, sus motivos de diferencia ya no pueden cambiar.

`shiftHandoffs.handOut` y `shiftHandoffs.receive` entran en la lista cerrada
de comandos críticos del ADR-0002.

## Consecuencias

- Cada relevo se audita desde ambos lados (`cash_session.handoff_out`,
  `cash_session.handoff_receive`) y aparece en Hoy como una entrada de
  relevo.
- Una caja abierta sin recibir su relevo hace que ese relevo deje de
  esperar; queda en el historial.
- La reasignación cambia `suspended_by`, así que el cajero entrante ve las
  ventas en la lista de suspendidas sin una regla de visibilidad nueva.
- La tolerancia es de todo el inquilino; una tolerancia por sede
  necesitaría un ajuste nuevo.

## Alternativas descartadas

- **Mantener una sola sesión entre cajeros.** Rompería la regla de una
  sesión por cajero y mezclaría los conteos de dos personas en un mismo
  sobrante o faltante.
- **Guardar la diferencia del recuento como sobrante o faltante de alguna
  sesión.** La sesión saliente ya está cerrada y firmada; la entrante aún
  no ha vendido. La diferencia pertenece al relevo.
