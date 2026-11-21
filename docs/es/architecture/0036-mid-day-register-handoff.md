# 0036: relevo de caja durante el día

**Idioma:** Español · [English](../../architecture/0036-mid-day-register-handoff.md)

> Estado: Aceptado
> Fecha: 21 de noviembre de 2026

## Contexto

Una caja cambia de manos durante el día. Antes de esta decisión el cajero que
salía cerraba el cajón y el siguiente lo abría con un fondo nuevo: nada unía
los dos conteos, la nota entre ellos quedaba en papel y las ventas suspendidas
seguían a nombre de alguien que ya se había ido.

## Decisión

Un relevo es su propia fila, `cash_session_handoffs`, escrita dentro de los
casos de uso de cierre y apertura que ya existen.

- `cashSessions.startHandoff` cierra la sesión de quien llama con un conteo a
  ciegas por denominación y, en la misma transacción, registra un relevo
  pendiente con el conteo, una nota opcional, un receptor opcional y cómo se
  firmó. La respuesta trae el conteo, nunca el saldo esperado.
- `cashSessions.receiveHandoff` abre la sesión de quien recibe en la misma
  caja. Un cajón conservado abre con el recuento, y su diferencia contra el
  conteo de salida se lee de los dos conteos guardados; un cajón nuevo abre con
  su propio fondo. Las ventas
  suspendidas de mostrador del cajero saliente en esa sede pasan a quien recibe
  y el relevo queda `received`, todo en la transacción de apertura.
- Abrir esa caja de otra forma marca el relevo pendiente como `superseded`.
  Un índice único parcial mantiene un solo relevo pendiente por caja.
- Cada lado firma con su PIN cuando lo tiene, con el mismo límite de intentos
  de PIN; sin PIN firma la sesión autenticada y la fila lo dice.
- Un encargado explica la diferencia de una sesión cerrada con un motivo
  (`wrong_change`, `unrecorded_withdrawal`, `other` con nota) y puede dejar una
  venta suspendida para el día siguiente. Ambas son columnas nuevas en
  `cash_sessions` y `sales`.

## Consecuencias

- Una sesión abierta por cajero y por caja, el vínculo con el turno laboral, las
  filas de auditoría y los efectos del diario siguen en los casos de uso de
  apertura y cierre; el hook del relevo devuelve sus efectos de auditoría para
  sumarlos a esa entrada del diario.
- Una venta dejada para mañana cuenta como tal solo mientras `carried_over_at`
  no sea anterior a `suspended_at`; suspenderla otra vez borra la decisión sin
  tocar la ruta de suspensión.
- `operations.today` muestra de qué relevo viene cada caja y las cajas
  entregadas que siguen esperando. El próximo relevo planeado nombra a quien
  recibe según el turno que empieza en la misma sede a menos de una hora,
  omite a quien ya atiende una caja y queda sin nombre cuando no hay nadie en
  el horario.
- Las cuentas de restaurante conservan el reparto por mesa y no se reasignan.
- En la caja, una caja que espera a quien la reciba reemplaza Abrir en la tecla
  principal y en el atajo de apertura, para que abrirla por costumbre no
  descarte el relevo. Si cada firmante necesita PIN lo dice
  `cashSessions.mySigner` y las ventas del turno vienen de
  `cashSessions.myShiftSummary`, ambas limitadas a quien llama.
