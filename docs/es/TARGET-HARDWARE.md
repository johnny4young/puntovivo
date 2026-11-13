# Medir Puntovivo en el equipo de la tienda

**Idioma:** Español · [English](../TARGET-HARDWARE.md)

Los presupuestos de [`PERF-BUDGETS.md`](./PERF-BUDGETS.md) se tomaron en un
Apple M4 y en los runners alojados del CI. Esta guía mide un build empaquetado
en el equipo para el que se hace Puntovivo: un Intel Celeron J1900 con 4 GB de
RAM y Windows 10 22H2. Microsoft terminó el soporte general de Windows 10 en
octubre de 2025; el piloto operativo acepta esa versión de todos modos.

El arnés está en `scripts/target-hardware/`:

| Archivo                 | Qué hace                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Measure-Puntovivo.ps1` | Instala un build, mide el arranque, las ventas y una prueba de 8 horas, y juzga la corrida contra U1 a U8. |
| `Compare-Runs.ps1`      | Compara las corridas de dos builds y usa una repetición del primero como nivel de ruido.                   |

Los dos corren en el Windows PowerShell 5.1 que trae Windows 10 y no necesitan
módulos adicionales.

## Qué necesitas

- El equipo J1900, su teclado y su lector de código de barras, y la impresora
  de recibos si la tienda tiene una.
- Una memoria USB para traer los resultados.
- Unas 10 horas por build. Te necesita más o menos una hora; la prueba de 8
  horas corre sola, así que arráncala en la noche.
- Dos descargas, guardadas en `C:\pv-measure\`:
  - El instalador de Windows del build a medir, por ejemplo
    `Puntovivo-1.17.1-win-x64.exe`, desde la página del release en GitHub o
    desde el artefacto `desktop-win-<sha>` de una corrida de Build Desktop
    (manual).
  - `Measure-Puntovivo.ps1` y `Compare-Runs.ps1` desde
    `scripts/target-hardware/` en GitHub. Abre cada archivo y usa Download raw
    file.

## Prepara el equipo una sola vez

1. Instala las actualizaciones pendientes de Windows y el driver de video Intel
   más reciente, y reinicia. El arnés registra solo la versión del driver, el
   tipo de disco, el archivo de paginación y el antivirus, así que no tienes
   que anotarlos.
2. Deja el equipo como estará en la tienda: el mismo antivirus, la misma
   resolución de pantalla y el archivo de paginación administrado por el
   sistema. En una ventana normal de Símbolo del sistema o de PowerShell,
   escoge Alto rendimiento y apaga la suspensión y el apagado de pantalla:

   ```powershell
   powercfg /setactive SCHEME_MIN
   powercfg /change standby-timeout-ac 0
   powercfg /change monitor-timeout-ac 0
   ```

3. Deja Windows en reposo mientras mides:
   - Configuración, Actualización y seguridad, Windows Update: Pausar
     actualizaciones 7 días, para que nada se instale ni reinicie el equipo
     durante una prueba larga.
   - Configuración, Sistema, Asistente de concentración: Solo alarmas, para
     que ninguna notificación le quite el foco a Puntovivo.
   - Cierra los demás programas y no uses el equipo mientras corre una fase.
4. Permite los dos scripts una vez, en una ventana de PowerShell abierta con tu
   usuario de siempre:

   ```powershell
   cd C:\pv-measure
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   Unblock-File .\Measure-Puntovivo.ps1, .\Compare-Runs.ps1
   ```

5. Instala el build:

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase install -Installer .\Puntovivo-1.17.1-win-x64.exe
   ```

6. Abre Puntovivo desde el menú Inicio y déjalo como en la tienda: crea la
   empresa, importa el catálogo de la tienda (o al menos 2.000 productos), dale
   a los productos que vas a escanear stock para unos cientos de ventas y abre
   la caja. Deja la facturación electrónica apagada, como en el piloto
   operativo, y deja apagada la opción de la bandeja que oculta la ventana al
   cerrarla.
7. Escribe `C:\pv-measure\barcodes.txt` con al menos 20 códigos de barras de
   productos de ese catálogo, uno por línea. Usa productos que se venden por
   unidad: nada pesado, sin lotes ni seriales, y códigos de 6 caracteres o más,
   porque el lector de la app ignora entradas más cortas. También sirve el CSV
   del catálogo si tiene una columna `barcode`.
8. Cierra Puntovivo, también desde el ícono de la bandeja, y guarda estos datos
   como la línea base de la que parte cada corrida:

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase baseline -Baseline C:\pv-measure\baseline.zip
   ```

   La carpeta de datos es `%APPDATA%\Puntovivo`. Restaurarla solo funciona con
   el mismo usuario de Windows en el mismo equipo, porque Windows protege la
   llave de la base para ese usuario.

## Mide un build

Ponle a cada corrida su propia etiqueta, por ejemplo `v1.17.1`, y `v1.17.1-b`
para una repetición del mismo build.

1. Instala el build y restaura la línea base. La carpeta de datos actual queda
   a un lado, junto a ella; no se borra.

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase install -Installer .\Puntovivo-1.17.1-win-x64.exe -Baseline C:\pv-measure\baseline.zip
   ```

2. Reinicia Windows, inicia sesión y espera 5 minutos sin tocar nada.
3. Arranque, unos 10 minutos. Puntovivo se abre tres veces. Cada vez, inicia
   sesión cuando aparezca la pantalla de ingreso; el arnés anota cuándo quedó
   usable esa pantalla y cuándo abrió el punto de venta, y luego cierra
   Puntovivo. La corrida 1 es el arranque en frío.

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase startup -Label v1.17.1
   ```

4. Ventas, unos 30 minutos. Inicia sesión cuando Puntovivo abra y vende como
   en la tienda: escanea 5 productos, pulsa `F2` para efectivo exacto y
   confirma. Cada venta se cronometra desde el primer escaneo hasta que se cierra el cobro. Escanea con el lector en vez de teclear los códigos: el arnés también mide el espacio entre las teclas del lector. Haz 10 ventas, espera 2 minutos y haz otras 10.

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase sales -Label v1.17.1
   ```

5. Respaldo durante la venta, en la misma fase. Haz clic en la ventana de
   PowerShell y pulsa `B`, ve a Empresa en Puntovivo y haz clic en Crear
   respaldo en la tarjeta del respaldo de la base local, y de inmediato
   intenta escanear y mover la ventana. Cuando termine el respaldo, haz clic en
   la ventana de PowerShell y pulsa `B` otra vez. Pulsa `Q` para terminar la
   fase; Puntovivo queda abierto.
6. Prueba larga, 8 horas. Deja Puntovivo al frente en la pantalla de ventas y
   arranca:

   ```powershell
   .\Measure-Puntovivo.ps1 -Phase soak -Hours 8 -Drive -Barcodes C:\pv-measure\barcodes.txt -Label v1.17.1
   ```

   El cajero simulado vende una vez por minuto: 3 a 6 códigos tecleados como
   lo hace un lector, `F2` y Enter. No uses el equipo hasta que termine. Si
   algo tapa a Puntovivo, el cajero lo vuelve a traer al frente; si eso falla
   varias veces, sigue por la conexión de DevTools, que solo llega a
   Puntovivo, y anota el cambio.

7. El arnés imprime el veredicto al final de cada fase. Copia la carpeta
   completa `C:\pv-measure\runs\v1.17.1\` a la memoria USB y tráela. Tiene
   mediciones y datos del equipo, no ventas de la tienda.

Mientras corre una fase, Puntovivo arranca con un puerto de DevTools abierto
solo en `127.0.0.1`, para que el arnés lea el estado de la pantalla y
cronometre el renderer, y con las actualizaciones automáticas apagadas, para
que el build no cambie a mitad de una corrida.

## Compara dos builds

1. El mismo equipo, el mismo usuario de Windows, el mismo día si se puede, y
   nada nuevo instalado entre corridas.
2. Mide el build A, luego el B y luego A otra vez con otra etiqueta. La segunda
   A mide cuánto varía el equipo por sí solo.
3. Compara:

   ```powershell
   .\Compare-Runs.ps1 -A C:\pv-measure\runs\v1.17.1 -B C:\pv-measure\runs\v1.18.0 -Noise C:\pv-measure\runs\v1.17.1-b
   ```

`compare.md` queda en la carpeta de B con una fila por métrica: A, B,
diferencia, porcentaje y veredicto. Una diferencia menor que el ruido de A
contra A, o menor que 10 % y 20 MB, es sin cambio. B es una regresión cuando
es peor en más de 10 % y 20 MB (memoria) o 15 % y 10 ms (tiempos), o cuando cualquier
umbral pasa de PASS a FAIL. `compare-curves.csv` tiene el working set de main
y de GPU minuto a minuto en las dos pruebas largas: una pendiente distinta
importa más que el valor final.

Guarda las carpetas de corrida fuera del repositorio. En él solo van el
resumen y los umbrales definitivos.

## Umbrales

Son puntos de partida. Después de la primera corrida en el equipo, fija los
valores definitivos en `perf-budget.json` bajo una clave nueva
`targetHardware`.

| Regla | Revisión        | Falla cuando                                                                                                                                                        |
| ----- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1    | GPU más utility | Los working sets de GPU y utility suman más de 1.024 MB en promedio durante los últimos 10 minutos de la prueba larga.                                              |
| U2    | Paginación      | Dentro de una venta, las lecturas de página siguen por encima de 20 por segundo durante 2 segundos o más, o la memoria libre baja de 150 MB. Con SSD, 50 sirve.     |
| U3    | Fuga            | En una prueba de 2 horas o más, un proceso crece más de 10 MB por hora desde la hora 1, o la memoria privada termina por encima de 1,5 veces su valor de la hora 1. |
| U4    | Memoria total   | Todos los procesos de Puntovivo juntos usan más de 1.600 MB en algún momento.                                                                                       |
| U5    | Tiempo de venta | La mediana de una venta pasa de 3 segundos o el percentil 95 pasa de 6. Se usan las ventas simuladas cuando las hay; los tiempos manuales incluyen el escaneo.      |
| U6    | Arranque        | El arranque en frío tarda más de 45 segundos hasta un ingreso usable, o la mediana del arranque tibio más de 20.                                                    |
| U7    | Bloqueo         | Entre las dos pulsaciones de `B`, el renderer se frena o una ida y vuelta de IPC tarda más de 1 segundo.                                                            |
| U8    | Estabilidad     | Durante la prueba larga Puntovivo se cierra o el proceso de GPU se reinicia.                                                                                        |

Cada veredicto es PASS, FAIL o SKIP; una regla se omite cuando su fase no
corrió.

Las lecturas de página también cuentan el código y los archivos que Windows lee
del disco por primera vez, no solo la memoria que se paginó. En un runner del
CI con 12 GB libres, U2 falló igual en la primera venta. Lee una falla de U2
junto a la memoria libre más baja de su detalle antes de tomarla como presión
de memoria.

El resumen también reporta el lector: el espacio más largo entre las teclas de
cada escaneo. Puntovivo toma las teclas separadas por más de 30 ms como
tecleo, así que un escaneo que no cabe en esa ventana abre la búsqueda de
productos en vez de agregar el producto. El cajero simulado escoge entonces el
producto ahí, como lo haría un cajero, y lo cuenta en `picked_from_search`. En
una VM de Windows 11 sobre un Mac con Apple silicon, la mayoría de los
escaneos simulados quedó fuera de esa ventana, así que revisa el espacio en el
propio equipo.

## Qué guarda una carpeta de corrida

| Archivo        | Contenido                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| `samples.csv`  | Working set, memoria privada, CPU, handles, hilos y memoria de GPU de cada proceso, por muestra.        |
| `system.csv`   | Memoria libre, memoria comprometida, lecturas de página, paginación, cola de disco y CPU, cada segundo. |
| `renderer.csv` | Percentiles de ida y vuelta de IPC, retraso del renderer, heap de JavaScript y tamaño del DOM.          |
| `sales.csv`    | Una fila por venta: duración, tiempo hasta el cobro, líneas y estado.                                   |
| `startup.csv`  | Una fila por arranque: ingreso usable, punto de venta listo y tiempo de cierre.                         |
| `markers.csv`  | Arranques, respaldos, notas, cambios de foco y cierres de procesos.                                     |
| `meta.json`    | Build, equipo, Windows, driver, disco, archivo de paginación y nivel gráfico.                           |
| `summary.json` | Las cifras que lee `Compare-Runs.ps1` y cada veredicto.                                                 |
| `verdict.md`   | La tabla de veredictos.                                                                                 |

El arnés sale con 0 cuando pasó cada regla juzgada, con 1 cuando falló alguna
y con 2 cuando no pudo medir. Para juzgar una corrida otra vez, por ejemplo
tras una interrupción o un cambio de umbral, corre
`.\Measure-Puntovivo.ps1 -Phase summarize -RunDir C:\pv-measure\runs\v1.17.1`.
Para repetir una fase de una corrida, agrega `-Force` a esa fase.

## Problemas comunes

- "Puntovivo is already running": ciérralo también desde el ícono de la
  bandeja y vuelve a correr la fase. La prueba larga se puede conectar al
  Puntovivo que dejó abierto la fase de ventas, pero no a uno abierto desde el
  menú Inicio.
- "cannot be loaded because running scripts is disabled": repite el paso 4 de
  la preparación.
- `focus_lost` o `input_fallback` en `markers.csv`: algo tapó a Puntovivo
  durante la prueba larga. La corrida sigue valiendo; revisa qué fue.
- `scan_miss` en `markers.csv`: ese código no agregó ningún producto. Quítalo
  de `barcodes.txt`.

## Autoprueba en el CI

Build Desktop (manual) tiene una entrada `harness`. Con `win` y `harness`
encendidos y `validate_only` apagado, un job de Windows instala el artefacto
del build con el arnés y lo corre en modo corto con Windows PowerShell 5.1: dos
arranques, una prueba de 2 minutos con el cajero simulado por entrada de
DevTools, otra de 4 minutos por SendKeys y una comparación de las dos.
La carpeta de corrida se sube como `target-hardware-selftest-<sha>`. Ese job
usa `-TestProfile`, que siembra los datos demo en un perfil desechable y
arranca Puntovivo con `PUNTOVIVO_E2E=1`, un `PUNTOVIVO_DB_KEY` desechable,
`--user-data-dir` y un `PUNTOVIVO_BIND_PORT` libre. Nunca uses `-TestProfile`
en el equipo que mides. `scripts/target-hardware-harness.test.mjs` corre los
dos scripts sobre corridas sintéticas en el job de automatización de
releases.
