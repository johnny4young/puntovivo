# 0037: cierre guiado del día

**Idioma:** Español · [English](../../architecture/0037-guided-day-close.md)

> Estado: Aceptado
> Fecha: 21 de noviembre de 2026

## Contexto

El cierre del día era una página de reporte con una casilla de constancia. Una
diferencia de caja se podía firmar sin motivo, las ventas suspendidas seguían
suspendidas para siempre y quien firmaba no dejaba rastro de cómo firmó. El
relevo agregó un motivo para la diferencia de una caja cerrada y una marca para
dejar una venta suspendida para mañana, pero nada exigía ninguno de los dos
antes de firmar.

## Decisión

- `reports.dayClose.preview` suma dos bloqueos: `unexplained_differences` (una
  sesión cerrada ese día con sobrante o faltante y sin motivo) y
  `unresolved_drafts` (un borrador de mostrador suspendido antes del fin del
  día que no se descartó ni se dejó para mañana). Las cuentas de restaurante
  siguen con su mesa y no cuentan. No hay tolerancia configurable: toda
  diferencia mayor al épsilon de centavos necesita motivo.
- `reports.dayClose.checklist` devuelve las filas por caja y por borrador sobre
  las que actúa el cierre guiado. La instantánea firmada guarda solo totales,
  así que las filas se leen en vivo y no entran en la huella.
- `reports.dayClose.signOff` acepta una firma opcional: el PIN del personal,
  verificado con el límite de intentos compartido, o una firma dibujada como
  trazo SVG limitado a movimientos y líneas absolutas. Sin firma, firma la
  sesión iniciada, como en la página del reporte. `day_close_signoffs` suma
  `signature_method` y `signature_path` con una migración aditiva; quedan fuera
  de la instantánea con huella y el PDF nombra el método.
- Hoy abre el cierre guiado de un día comercial con `?close=`, y la
  página del reporte enlaza ahí cada bloqueo nuevo.

## Consecuencias

- Las dos pantallas leen la misma preparación, así que la página del reporte no
  puede firmar un día que el cierre guiado rechazaría.
- Las firmas anteriores se leen como `session`; sus huellas no cambian.
- Una tienda con borradores suspendidos viejos debe descartarlos o dejarlos
  para mañana antes de su próxima firma.
- El resumen para el dueño se arma en el dispositivo y abre WhatsApp solo con
  totales; no se llama a ningún servicio.
