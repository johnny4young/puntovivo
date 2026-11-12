# 0034: reiniciar el worker del servidor tras una caída

**Idioma:** Español · [English](../../architecture/0034-server-worker-restart.md)

> Estado: Propuesto
> Fecha: 12 de noviembre de 2026
> Reemplaza la cláusula "Salida inesperada" del [ADR-0032](0032-embedded-server-worker-thread.md).

## Contexto

Con el ADR-0032, toda salida del worker que `stop` no pidió cierra la app. Una
caída a mitad de turno deja la caja cerrada hasta que alguien la vuelva a
abrir, y el cajero tiene que iniciar sesión y armar el carrito otra vez. Casi
ninguna caída deja algo roto: SQLite revierte la transacción abierta y el
siguiente worker abre la misma base.

Hay dos casos distintos. Una base dañada o una llave que ya no la abre fallan
igual en cada arranque, así que reiniciar solo esconde el daño. Y una caída que
se repite cada pocos segundos no puede quedar en bucle.

Completar una venta se puede reintentar sin riesgo. `sales.create` y
`sales.completeDraft` marcan la fila de idempotencia como `succeeded` en la
misma transacción de SQLite que la venta y su intent fiscal. Si se pierde la
respuesta, el renderer conserva el sobre del comando (no hubo respuesta
estructurada) y el reintento devuelve la venta guardada. Si el worker muere
antes del commit, no queda nada de la venta y la reserva sigue en
`processing`.

## Decisión

Main reinicia el worker del servidor cuando muere después de empezar a servir.

| Situación                                                         | Acción                                         |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| Falla en el primer arranque                                       | Fatal, como antes                              |
| Salida durante `restartAround` (backup, restore, rotación)        | Como antes: el error vuelve al llamador        |
| Salida inesperada mientras sirve                                  | Reinicio                                       |
| `SQLITE_CORRUPT`, `SQLITE_NOTADB`, falla del anchor o de la llave | Fatal con código de soporte; nunca se reinicia |
| Un cuarto reinicio dentro de diez minutos                         | Fatal con código de soporte                    |

- **Espera.** 0,5 s, 2 s y 8 s antes del primer, segundo y tercer reinicio en
  una ventana móvil de diez minutos. Diez minutos sin caídas limpian la
  cuenta. Un reinicio cuyo arranque falla cuenta como intento.
- **Misma identidad.** El worker nuevo recibe el mismo puerto, la llave de la
  base, el secreto del anchor y el secreto JWT, así que los tokens siguen
  válidos y el cajero no pierde la sesión.
- **Un worker a la vez.** La recuperación y `restartAround` comparten una
  cola; ninguno arranca un worker mientras el otro trabaja.
- **Causa.** El manejador de caídas del worker envía el error serializado a
  main antes de que el hilo termine; una salida por límite de heap se
  clasifica como `oom`. Una caída nativa sigue terminando todo el proceso
  (ADR-0032).
- **Argon2 en vuelo.** Un hash que termina después de que su hilo murió
  aborta todo el proceso (`Napi::Error` en la finalización nativa). Por eso el
  manejador de caídas del worker espera los hashes en curso antes de terminar
  el hilo. Una salida que el worker no controla no puede esperar; ver las
  consecuencias.
- **Renderer.** Main publica `server:state` (`running`, `restarting`,
  `fatal`). Mientras reinicia, la franja de estado dice que la app se está
  reconectando y los botones de cobro quedan deshabilitados; el carrito se
  conserva. Cuando el servidor vuelve, se invalidan todas las consultas y un
  único aviso pide revisar la última venta.
- **Reservas abandonadas.** Al arrancar, el servidor marca como fallidas las
  reservas `processing` de los comandos que se completan dentro de su propia
  transacción. Al arrancar no puede haber un dueño vivo, y para esos comandos
  `processing` prueba que nada se guardó, así que el reintento con el mismo
  contenido corre una vez de inmediato en lugar de esperar el lease de 60 s.
  Un contenido distinto sigue en conflicto. Los comandos que se completan
  después de su commit siguen dependiendo del lease.
- **Sin reintento a ciegas.** Main nunca reenvía una llamada que estaba en
  vuelo. El renderer conserva su sobre, así que el siguiente "Cobrar" del mismo
  carrito devuelve la venta guardada o la ejecuta una sola vez.

### Telemetría

Cada salida agrega una entrada a `worker-crashes.ndjson` en `userData` (las
últimas 50): hora, tipo (`oom`, `uncaught`, `unknown`), código de salida,
código de error cerrado, tiempo en servicio, llamadas en vuelo, intento,
resultado, causa fatal y versión. Sin texto de mensajes, datos del tenant ni
secretos. Los mismos campos van a la telemetría de caídas cuando hay DSN.
Operaciones muestra "Reinicios del servidor: N en 7 días" y la exportación de
diagnóstico incluye las entradas.

### Límites de memoria

El worker arranca con `resourceLimits.maxOldGenerationSizeMb = 384`. Si lo
supera, Node termina solo el worker con `ERR_WORKER_OUT_OF_MEMORY`, que se
clasifica como `oom`, y aplica la política de reinicio en lugar de llevar la
caja a paginar. El valor es provisional hasta el soak en la caja objetivo: el
tope debe quedar al menos al doble del pico observado.
`PUNTOVIVO_SERVER_WORKER_MAX_OLD_MB` lo cambia por equipo mientras se calibra.

Una salida por límite de heap es de las que el worker no puede demorar: si en
ese momento corre un hash de contraseña o PIN, se cae toda la app, como se
explica en Consecuencias. En los demás casos el tope convierte una caída lenta
hacia la paginación en un reinicio.

El tope cubre solo el heap de V8; la caché de páginas de SQLite, `mmap`, Argon2
y los buffers quedan fuera. El worker informa cada 60 s el RSS del proceso, el
heap y el uso del event loop. Dos informes seguidos por encima de 900 MB de RSS
(también provisional) dejan una advertencia en el log y una entrada
`memory-alert` en el registro de caídas. La v1 nunca reinicia un worker solo
por memoria.

### Documentos fiscales en vuelo

El apagado ordenado sigue esperando 90 s por las llamadas al proveedor. Una
caída no pierde ninguna obligación: el intent fiscal se escribe en la
transacción de la venta y el worker fiscal lo retoma cuando vence su lease. Un
adaptador real debe consultar el estado del documento (prefijo y número, o
CUDE/CUFE) antes de reenviar uno que quedó `sent` sin veredicto; nunca lo
reemite a ciegas ni gasta un consecutivo nuevo.

## Consecuencias

- Una caída le cuesta al cajero unos segundos de "reconectando" en lugar de
  una app cerrada y un nuevo inicio de sesión.
- Una base o llave dañadas siguen deteniendo la app, con un código que soporte
  puede usar.
- Un worker terminado desde fuera mientras corre un hash de contraseña o PIN
  (inicio de sesión, cambio de cajero, los primeros segundos tras arrancar)
  todavía cierra la app, como pasaba antes con cualquier caída. Sacar el
  hashing del entorno del worker, o llevar el worker a un utility process, lo
  resolvería.
- El registro de caídas y el contador de reinicios muestran las caídas
  repetidas antes de que la tienda las reporte.

## Alternativas descartadas

- **Mantener toda salida como fatal.** Es seguro, pero convierte una caída
  pasajera en una caja cerrada a mitad de turno.
- **Reinicios sin límite.** Esconde un bucle de caídas y puede girar sobre una
  base dañada.
- **Reenviar desde main las llamadas en vuelo.** Main no puede saber si una
  llamada hizo commit; el reintento con el mismo sobre ya lo resuelve.

## Verificación

- pruebas unitarias de la política (espera, bucle, corrupción y llave), del
  ciclo de vida (mismo secreto JWT, reinicios fallidos, apagado, exclusión con
  `restartAround`), de la clasificación de salidas del host y del registro;
- un worker real que se cae con un mensaje de prueba y libera su puerto;
- una prueba del servidor que libera reservas abandonadas solo para comandos
  transaccionales y conserva los conflictos de contenido;
- un E2E de Electron que tumba el worker y completa la siguiente venta en la
  misma sesión.
