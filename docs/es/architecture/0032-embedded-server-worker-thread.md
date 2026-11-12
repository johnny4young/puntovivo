# 0032: servidor embebido en un worker thread

**Idioma:** Español · [English](../../architecture/0032-embedded-server-worker-thread.md)

> Estado: Aceptado
> Fecha: 7 de noviembre de 2026

## Contexto

Electron empaquetado corre la autoridad Fastify, tRPC, Drizzle y la conexión
SQLCipher en el hilo principal, el mismo que maneja ventanas, menús, IPC,
`safeStorage` y el actualizador. Cada sentencia síncrona de SQLite y cada paso
de tRPC, Zod o Drizzle retrasan la UI nativa y cada `ipcRenderer.invoke` del
renderer.

Una prueba de concepto en un Mac con chip Apple y carga alta (cifras
indicativas, 20 ventas por la UI real) midió:

| Métrica                         | En proceso | Worker thread | Utility process |
| ------------------------------- | ---------: | ------------: | --------------: |
| Hilo principal bloqueado        |      21.4% |          0.7% |            3.6% |
| Peor bloqueo del hilo principal |     249 ms |         16 ms |          234 ms |
| IPC ida y vuelta, p99           |     131 ms |        1.6 ms |           18 ms |
| Memoria en reposo sobre la base |          — |        +21 MB |          +46 MB |

SQLite síncrono explicó cerca del 42% del bloqueo; el resto fue JavaScript del
propio servidor. La venta no se aceleró: lo que mejora es la fluidez, que pesa
más en las cajas Windows de cuatro núcleos y 4 GB a las que apunta Puntovivo.

`safeStorage` solo existe en el proceso principal. Desde la migración a
`safeStorage` asíncrono, el estado de anclas de auditoría ya no lo llama en
cada operación: el archivo se sella en el proceso con AES-256-GCM, con una
llave derivada (HKDF-SHA256) del secreto de anclas sellado en el llavero. Solo
la conversión única de un archivo escrito por una versión anterior necesita
`safeStorage`. Ningún camino del servidor necesita `safeStorage` dentro de una
transacción de SQLite.

## Decisión

Electron, empaquetado y en desarrollo, corre el servidor embebido en un
`worker_threads` dentro del proceso principal. El renderer sigue hablando con
el listener HTTP de loopback; solo cambia el hilo que lo atiende.

### Responsabilidades

| Hilo principal                                                             | Worker del servidor                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Ventanas, menús, bandeja, protocolo del renderer, CSP                      | Listener de Fastify, routers tRPC, Zod, servicios de aplicación         |
| Cada handler de `ipcMain` y sus chequeos de confianza                      | Drizzle y la conexión SQLCipher que sirve a la app                      |
| `safeStorage` y cada sobre sellado (llave de base, secreto de anclas, hub) | Hashing Argon2 y su calentamiento                                       |
| Rotación de llave, migración a cifrado, restauración y copias de archivo   | Workers fiscales, outbox, tiempo real y sync del servidor               |
| Actualizador automático y su piso de versión                               | El almacén de anclas en archivo (PVA1), abierto con el secreto recibido |
| Custodia de sesión, relay de Store Hub, periféricos e impresión            | Operaciones de escritorio que tocan la base (ajustes, sync, drill)      |
| Su propia telemetría de caídas y el reporte de salidas del worker          | Logs y telemetría del servidor, con la misma política de caídas         |

El ensayo de recuperación empaquetado sigue creando sus servidores en el
proceso principal: nunca abre ventana, así que ahí no importa la latencia del
hilo principal.

### Secretos

El hilo principal resuelve la llave de SQLCipher, el secreto de anclas y el
secreto JWT de la vida del proceso como hoy, y los manda en el mensaje `start`
del worker, nunca en variables de entorno ni en argv. El worker los guarda
solo en memoria y nunca los escribe en logs. Un reinicio los vuelve a mandar;
la rotación de llave ocurre sin worker corriendo, así que el siguiente recibe
la llave nueva.

### `safeStorage` y el almacén de anclas

El worker nunca llama a `safeStorage`. El hilo principal hace la conversión
única del archivo de anclas antiguo antes de arrancar un worker; el worker
abre el almacén PVA1 con el secreto que recibió. El hilo principal solo manda
la ubicación del almacén cuando el secreto de anclas viene del llavero; las
instalaciones con la llave del entorno o la de desarrollo corren sin almacén de
anclas, como hoy. Si la conversión falla, el archivo viejo queda intacto y toda
escritura auditada falla cerrada, como hoy.

Solo un hilo puede escribir el archivo de anclas a la vez. La restauración
reemplaza la base y el estado de anclas solo después de que el worker salió,
nunca mientras se detiene. Si algún día el servidor necesita `safeStorage`,
debe ser una petición asíncrona al hilo principal fuera de toda transacción de
SQLite; bloquear el worker con `Atomics.wait` dentro de una transacción no
está permitido.

### Protocolo

El hilo principal y el worker intercambian mensajes por structured clone en el
puerto del worker:

- cada petición lleva un id, un nombre de operación de una lista cerrada y un
  payload;
- cada respuesta lleva el mismo id y un resultado o un error serializado
  (`name`, `message` y un `code` opcional de lista cerrada), nunca un objeto
  crudo;
- el worker valida cada payload: quien llama desde el hilo principal es de
  confianza, pero no infalible;
- cuando el worker sale, el hilo principal rechaza cada petición que aún espera
  respuesta, y las nuevas fallan de inmediato hasta que el siguiente worker
  reporte su URL.

La lista de operaciones reemplaza cada sitio donde el hilo principal entra al
objeto del servidor: las rutas fijas de autenticación por `inject`, la
verificación del token de acceso, el reclamo de instalación, la recuperación
del dueño, los tres eventos de auditoría que registra el hilo principal, la
lectura y escritura de `app_settings`, el puente de sync de escritorio y los
conteos del simulacro de restauración. El código del hilo principal depende de
una interfaz `EmbeddedServerHost` con una implementación en proceso (pruebas,
ensayo) y una sobre el worker (la app).

### Ciclo de vida

- **Arranque.** El hilo principal crea el worker, espera a que cargue, manda
  `start` y continúa cuando el worker reporta su URL. Un fallo en el primer
  arranque es fatal, como hoy. Un fallo cuando `restartAround` arranca el
  siguiente worker vuelve a quien pidió la copia, la restauración o la
  rotación, como hoy.
- **Parada.** El hilo principal manda `stop`; el worker cierra el servidor, que
  drena peticiones, espera el trabajo de Argon2 y cierra la base, y sale solo.
  El hilo principal espera el evento `exit` y termina el worker solo tras un
  plazo de gracia mayor que el timeout del adaptador fiscal. `terminate()` no
  interrumpe una llamada nativa síncrona, así que el límite rige entre
  sentencias.
- **Reinicio alrededor de copias, restauración y rotación.** La coreografía
  `restartAround` detiene el worker, corre la operación y arranca uno nuevo
  con el mismo secreto JWT, así que las sesiones sobreviven.
- **Salida inesperada.** Toda salida que `stop` no pidió, con cualquier
  código, es fatal: el hilo principal lo registra, lo reporta a la
  telemetría de caídas, muestra el diálogo de error y cierra la app, que es lo
  que pasa hoy si el servidor en proceso se cae. Reemplazada por el
  [ADR-0034](0034-server-worker-restart.md): ahora el worker se reinicia salvo
  que la base o la llave estén dañadas o que siga cayéndose.
- **Política de caídas en el worker.** El worker instala los handlers del hilo
  principal: un rechazo no manejado se registra y se reporta, sin ser fatal; una
  excepción no capturada termina el hilo.
- **Errores.** Los errores de una petición cruzan solo como códigos
  serializados; los logs quedan en el logger del worker.

### Módulos nativos

`better-sqlite3-multiple-ciphers` 13 y `argon2` 0.45 son addons Node-API, que
Node carga en worker threads. El hilo principal sigue cargando el addon de
SQLite para sus conexiones cortas (copias, rotación, snapshots del drill), así
que el addon corre en dos entornos del mismo proceso. Las copias programadas y
los snapshots del drill ahora corren junto al escritor del worker, así que su
checkpoint del WAL puede esperar a una venta hasta su `busy_timeout` en el hilo
principal; sacar ese trabajo del hilo principal queda fuera de esta decisión.
El verificador de
runtime nativo y el smoke empaquetado deben probar que ambos addons cargan y
funcionan dentro de un worker con el Electron que se distribuye, en cada
plataforma soportada.

## Consecuencias

- La UI nativa y el IPC siguen fluidos mientras el servidor trabaja; la venta
  no se acelera.
- La memoria del worker es parte del proceso `Browser` de Electron, así que el
  presupuesto `main` ya la cuenta; se recalibra con el delta medido.
- Una caída nativa dentro del worker sigue terminando todo el proceso, como
  hoy. Aislar caídas nativas es la ventaja del utility process y no es parte de
  esta decisión.
- El código del hilo principal ya no puede tocar la base directamente. Una
  función nueva de escritorio que necesite datos agrega una operación a la
  lista cerrada.
- El hilo principal solo importa la entrada liviana
  `@puntovivo/server/desktop-main` y carga el ensayo de recuperación
  empaquetado de forma diferida. Si no, el hilo principal y el worker evaluarían
  cada uno todo el grafo del servidor: +53 MB medidos en main en vez de +22 MB.
- La telemetría se registra dentro del worker junto con el servidor, así que el
  hilo principal registra su propio adaptador para sus caídas y para un worker
  que muere.

## Alternativas descartadas

- **Dejar el servidor en proceso.** Mantiene el bloqueo medido del hilo
  principal y la cola de IPC en el hardware más lento soportado.
- **`utilityProcess`.** Cuesta cerca del doble de memoria, agrega un proceso
  que arrancar y un segundo salto de IPC, y su cola de IPC medida fue peor que
  la del worker. Queda como plan B si aislar caídas nativas llega a importar
  más que la memoria.
- **`safeStorage` síncrono con `Atomics.wait`.** Conservaría el formato viejo
  de anclas, pero bloquea el hilo del servidor dentro de una transacción
  esperando al principal, y se traba si el principal espera al worker.
- **Solo SQLite en un worker y Fastify en el principal.** Mueve cerca del 42%
  del bloqueo y agrega un salto a cada sentencia.

## Verificación

- pruebas unitarias del protocolo, del ciclo de vida y de la separación del
  almacén de anclas;
- `pnpm run ci:desktop`, con una compuerta que mide el bloqueo del hilo
  principal y el p99 de IPC mientras el servidor trabaja;
- la compuerta de memoria de Electron con el presupuesto `main` recalibrado;
- el smoke empaquetado en Linux, macOS y Windows con `build-desktop.yml`.
