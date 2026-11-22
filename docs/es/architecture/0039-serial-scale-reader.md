# 0039: lector de báscula serial en el proceso main del escritorio

**Idioma:** Español · [English](../../architecture/0039-serial-scale-reader.md)

> Estado: Aceptado
> Fecha: 2026-11-21

## Contexto

Las tiendas de barrio y las carnicerías pesan productos sueltos. El panel de
peso ofrecía teclas de peso, venta por valor y peso escrito, pero con una
báscula en el mostrador el cajero seguía leyendo su pantalla y escribiendo el
número. El renderer corre en sandbox y no puede abrir un puerto serial.

## Decisión

- El proceso main de Electron lee la báscula con `@serialport/bindings-cpp`
  (MIT), cargado al primer uso. Trae binarios Node-API precompilados, así que el
  empaquetado mantiene `npmRebuild: false`; el hook afterPack conserva solo la
  carpeta del destino y falla si no existe.
- La báscula se configura por equipo, no por sede: el puerto es del computador
  donde está conectada. Main guarda un archivo privado por negocio en
  `userData/scale-preferences`, igual que la impresora del sistema.
- Tres protocolos: envío continuo (líneas estilo CAS/A&D), Toledo 8217 con
  solicitud `W` y estilo ECR con solicitud `ENQ`. Velocidad de 2400 a 19200
  baudios y formato 8N1 o 7E1. El peso debe venir en kilogramos o gramos; una
  báscula en libras se informa, nunca se convierte.
- Una lectura devuelve el primer peso estable en 2,5 s. Las tramas sin marca de
  estabilidad cuentan cuando dos seguidas coinciden. Movimiento, sobrecarga,
  negativo, plato vacío, silencio, puerto ocupado o ausente tienen cada uno su
  código, y el cajero siempre puede escribir el peso.
- Administradores y encargados listan puertos, prueban un borrador y guardan;
  solo se guarda o prueba un puerto que el sistema operativo enumeró. Cualquier
  rol con sesión puede leer, y solo de la selección guardada, así que el
  renderer nunca nombra una ruta de dispositivo para leer.
- Las lecturas de un equipo corren una a la vez para que las tramas no se
  mezclen.

## Consecuencias

- Una dependencia nativa nueva viaja con la app de escritorio; si su addon no
  carga, la tarjeta de ajustes lo dice y la caja oculta «Leer báscula».
- Sin cambios de servidor, esquema ni sincronización: la lectura llena la misma
  línea pesada que un peso escrito.
- Ningún modelo de báscula está homologado; la validación física sigue la
  puerta de homologación de hardware de `docs/HARDWARE-POS.md`.
