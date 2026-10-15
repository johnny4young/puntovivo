# Hardware del punto de venta

**Idioma:** Español · [English](../HARDWARE-POS.md)

Puntovivo mantiene los efectos de hardware fuera de la transacción de venta.
Una venta completada queda persistida antes de intentar imprimir, abrir el
cajón, procesar el lector o actuar sobre una terminal. Los fallos de hardware
se registran en cola, son observables y se pueden recuperar.

## Límite actual de soporte

| Dispositivo o transporte            | Estado actual                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| Impresora del sistema               | Implementada mediante el límite de impresión de Electron.                                        |
| ESC/POS por TCP                     | Implementado con validación del destino e informe de errores.                                    |
| ESC/POS directo por USB             | No implementado; la configuración no debe afirmar que está soportado.                            |
| ESC/POS directo por puerto serie    | No implementado; la configuración no debe afirmar que está soportado.                            |
| Cajón RJ11 mediante ESC/POS         | Implementado si el transporte de la impresora seleccionada admite el pulso del cajón.            |
| Lector de códigos USB HID           | Implementado como entrada de teclado, con protección del foco del cajero.                        |
| Terminal de pago manual             | Implementada como registro de un medio de pago manual.                                           |
| SDK/API de terminal de un proveedor | Existe el punto de integración; ningún proveedor está homologado para producción.                |
| Puente local de cliente Hub         | Implementado como puente IPC de renderer a main que envía bytes localmente sin acceso a la base. |

## Arquitectura

- La configuración y el estado de dispositivos se limitan al negocio y a la sede.
- La bandeja de hardware registra efectos reintentables y estados finales.
- El renderer nunca abre sockets ni dispositivos nativos directamente.
- El preload de Electron expone APIs invoke/handle limitadas; main controla el transporte local.
- El puente de un cliente Hub puede imprimir o abrir el cajón localmente, pero
  no escribir tablas de ventas, caja, inventario, fiscalidad, diario o sincronización.
- Un fallo de impresora o cajón no debe revertir una venta confirmada.
- Las acciones de prueba y diagnóstico deben ser auditables y estar protegidas por rol.

## Áreas principales de implementación

- `packages/server/src/services/peripherals/`: contratos, registro, worker,
  transportes, política de destinos y controladores.
- `packages/server/src/db/schema/hardware.ts`: persistencia de periféricos y bandeja de hardware.
- `apps/desktop/src/main/peripherals/`: puente local y transporte Electron.
- `apps/desktop/src/main/ipc/peripherals.ts`: registro y validación IPC.
- `apps/web/src/features/peripherals/`: configuración administrativa y pruebas.

## Requisitos de homologación física

Un dispositivo solo tiene soporte validado cuando un candidato a release demuestra:

1. Impresión, corte, pulso de cajón, reconexión, tiempo de espera y comportamiento ante trabajos duplicados.
2. Escaneo a velocidad de caja, restauración del foco y manejo de escaneos duplicados.
3. Pérdida de energía y reinicio de la aplicación con trabajos de hardware pendientes.
4. Alternativas seguras que conservan la venta e informan qué falló.
5. Modelo, firmware, sistema operativo, conexión y pasos de recuperación en una matriz de soporte mantenida.
6. Cancelación, tiempo de espera, respuesta duplicada y política de riesgo sin conexión para cada proveedor de pagos anunciado como soportado.

Sigue las verificaciones de candidatos a release de [TESTING.md](TESTING.md).
Los requisitos pendientes de hardware y pagos se resumen en
[PROJECT-STATUS.md](PROJECT-STATUS.md).
