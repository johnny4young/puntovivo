# 0035: armar los respaldos fuera del hilo principal

**Idioma:** Español · [English](../../architecture/0035-backups-off-the-main-thread.md)

> Estado: Propuesto
> Fecha: 12 de noviembre de 2026

## Contexto

El ADR-0032 movió el servidor a un worker, pero dejó en el hilo principal los
respaldos programados y los manuales. `createBackupBundle` corre un
`wal_checkpoint(FULL)` que puede esperar hasta 5 s (`busy_timeout`) por una
venta, un `VACUUM INTO` que descifra y vuelve a cifrar toda la base en una sola
llamada nativa, un `integrity_check` y el zip. En una caja sin AES-NI eso es
AES por software en el hilo que pinta la ventana.

## Decisión

Cada paquete de respaldo se arma en un worker de `worker_threads` de vida
corta, que main lanza para ese respaldo y que termina con él.

- Main conserva lo suyo: el programador, la cola de operaciones,
  `safeStorage`, la bóveda en la nube y el IPC. El worker recibe
  la ruta de la base, la llave, la ruta de salida, la ruta del id del equipo, la frase y el manifiesto
  por mensaje, nunca por argv ni por el entorno, y corre el mismo
  `createBackupBundle`; el formato del paquete no cambia.
- La cancelación cruza como un mensaje `cancel`, que se revisa entre pasos. Una
  llamada nativa que ya corre termina primero; el directorio temporal lo borra
  el código del paquete o el barrido de arranque.
- Antes de copiar, el paquete comprueba que el volumen temporal y el de
  destino tengan espacio para dos copias de la base (más el WAL): el doble si
  comparten volumen, una en cada uno si son distintos. Si no, falla con
  `BACKUP_DISK_SPACE_LOW`.
- Un respaldo programado que ya toca espera mientras haya habido una venta en
  los últimos dos minutos, como máximo dos horas. Main se entera de las ventas
  por las respuestas de la API que ya ve.
- El verificador nativo y el smoke empaquetado cargan el addon de SQLite en
  main y en dos workers a la vez, que es lo que hacen main, el worker del
  servidor y un worker de respaldo.
- La restauración y la rotación de la llave no cambian: siguen dentro de
  `restartAround`, con el servidor detenido.

El estado del ancla de auditoría no va en el paquete. La restauración lee las
cabezas de la cadena de auditoría de la base restaurada y reemplaza el estado
del ancla solo después de que el operador confía en esa restauración, así que
el paquete no lo necesita.

## Consecuencias

- La ventana sigue respondiendo mientras corre un respaldo; el respaldo no es
  más rápido y sigue usando un núcleo.
- Cada respaldo suma por un rato otro entorno del addon y su caché de páginas
  de SQLite al proceso.
- El simulacro de restauración todavía extrae y revisa su copia en main;
  solo corre cuando un administrador lo pide.
- `VACUUM INTO` mantiene una lectura abierta todo el tiempo, así que el WAL no
  se puede truncar hasta que termine; el soak mide cuánto crece.

## Alternativas descartadas

- **Correr el respaldo en el worker del servidor.** Bloquearía las ventas
  durante todo el `VACUUM INTO`.
- **`utilityProcess`.** Aísla mejor de una caída nativa, pero cuesta unos 40 MB
  más durante el respaldo y un salto más. Queda como plan B si tres entornos
  del addon en un proceso dan problemas en el equipo objetivo.

## Verificación

- un paquete armado por el worker que se extrae, pasa `integrity_check` y
  conserva todas las filas;
- el peor bloqueo del hilo principal durante un respaldo en worker queda bajo
  100 ms y bajo el del respaldo en el hilo;
- cancelación por mensaje, un worker que muere sin resultado, la espera por
  caja tranquila y su tope de dos horas;
- el verificador nativo con dos workers a la vez y el smoke empaquetado que
  busca `backup-worker.cjs` en Linux, macOS y Windows.
