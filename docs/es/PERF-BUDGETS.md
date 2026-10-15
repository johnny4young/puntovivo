# Presupuestos de rendimiento

**Idioma:** Español · [English](../PERF-BUDGETS.md)

> Estado: motor entregado (tamaño de bundles + latencia p95 de tRPC con fixtures y volumen de tienda + perfil de búsqueda de productos de 1k/10k/50k + verificación/redacción de cadenas de auditoría de 100k + interfaz a escala de datos + prueba prolongada de jornada en el mismo renderizador + importación de lanzamiento + respaldo cifrado + cola de recuperación acotada + memoria/inicio de Electron + métricas web de Lighthouse).
> Fuente de verdad: `perf-budget.json` en la raíz del repositorio.

Este documento explica cómo Puntovivo exige presupuestos de rendimiento en CI y
qué hacer cuando una compilación detecta una regresión. El principio es el mismo
que el del mínimo de cobertura: cada regresión es una decisión deliberada,
documentada en el mismo PR que la produce.

El workspace laboral de carga diferida conserva su línea base de 5.55 kB gzip
(medición histórica de 5.54 kB). El espacio de nombres de auditoría de
localización se controló inicialmente en 5.05 kB (medidos: 5.03 kB); su límite
actual es 5.5 kB tras medir 5.33 kB de textos de auditoría diferidos acumulados.
La fuente de verdad actual es el presupuesto JSON, no una medición anterior.
Los formularios laborales y el historial privado cargan solo al abrir el
workspace laboral, no al iniciar la aplicación.

Las mediciones citadas a continuación son referencias históricas conservadas,
no una nueva calificación de ejecución realizada en esta actualización documental.
Cuando una observación conservada no tiene fecha, no establece la preparación
actual del candidato ni de runners alojados.

## Alcanzabilidad de chunks de inicio

El entorno de consultas/TRPC y el registro de TanStack Table usado solo en
interacciones tienen chunks separados. Sus límites son 36 kB y 18 kB gzip,
respectivamente: los mismos 54 kB combinados y 5% de tolerancia del antiguo
entorno único de datos. La prueba de regresión del manifiesto de producción
recorre las importaciones estáticas desde la estructura principal y el POS,
rechaza nodos faltantes del grafo y demuestra que Table sigue siendo alcanzable
desde el historial de ventas sin entrar en el cierre de dependencias de la ruta inicial.

El helper compartido de precarga de Vite tiene un grupo pequeño de ejecución
con alta prioridad. Sin esa asignación, la agrupación recursiva de proveedores
puede ubicarlo dentro del chunk PDF y hacer que cada importador dinámico cargue
PDF anticipadamente pese a usar `import()` en el código fuente. La prueba de
regresión también excluye PDF del cierre estático de la estructura principal/POS;
las interacciones reales de historial y exportación deben seguir funcionando.
`codeSplitting.groups` nativo de Rolldown conserva los valores predeterminados
de dependencias recursivas y la deduplicación de React. Los nombres de chunks
por sí solos no prueban la carga diferida.

Los módulos de inicio compartidos por la entrada y las rutas diferidas (iconos,
`Button`, `Modal`, helpers monetarios, cliente tRPC, autenticación) se reúnen en
un chunk `app-shell` (etiqueta `$initial`, `minShareCount: 2`). De otro modo,
Rolldown los entrega como decenas de chunks menores de 3 kB. Lighthouse simula
cada solicitud con RTT de 150 ms sobre seis conexiones HTTP/1.1, por lo que el
número de solicitudes, y no los bytes, determinó FCP y LCP. La estructura
principal parte de 12 archivos en lugar de 48. Mantén el grupo con prioridad
predeterminada después del grupo de proveedores: una prioridad negativa prevalece
sobre todos los grupos y absorbe las divisiones de proveedores y textos de error.
La prueba de regresión de artefactos acota el cierre de inicio y rechaza un ciclo
de importación `app-shell` → entrada.

### Formato de fechas en renderizados repetidos del POS

El formato de fechas por tenant reutiliza como máximo 64 objetos
`Intl.DateTimeFormat`, identificados por configuración regional y el conjunto
completo y canonizado de opciones (incluida la zona horaria). Nunca se retienen
fechas ni resultados formateados. Las llamadas sin zona explícita evitan la
reutilización para no ocultar cambios de zona horaria del SO. El oráculo de
prueba cubre horario de verano, configuración regional, calendario, numeración y
variantes de ciclo horario. Esto elimina la construcción repetida de
formateadores ICU sin ocultar controles de cobro ni cambiar presupuestos
existentes de puntuación Lighthouse, latencia, transferencia o memoria. Por sí
solo no demuestra que se haya resuelto un fallo concreto de rendimiento en un runner alojado.

## Qué se exige actualmente

| Métrica                                                                                                                      | Dónde                                 | Ejecutor de la verificación                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Tamaño gzip del bundle JavaScript por chunk                                                                                  | `ci:web`                              | `scripts/check-bundle-size.mjs` después de `vite build`                        |
| Latencia p95 de procedimientos tRPC para un conjunto seleccionado de rutas de lectura                                        | `ci:server`                           | `__tests__/perf-trpc-latency.test.ts` mediante vitest                          |
| Volumen de datos SQLite de tienda, p95 de lecturas frecuentes y planes de consultas críticas                                 | `ci:server`                           | `packages/server/scripts/run-store-profile-gate.mjs` → vitest aislado          |
| Tiempo de creación del perfil de productos/farmacia, relevancia de búsqueda literal y p95 con 1k, 10k y 50k filas            | `ci:server`                           | `packages/server/scripts/run-product-search-profile-gate.mjs` → vitest aislado |
| Verificación indexada de cadena de auditoría, redacción transaccional y RSS con 100k filas                                   | `ci:server`                           | `packages/server/scripts/run-audit-chain-profile-gate.mjs` → vitest aislado    |
| Tiempo de vista previa y confirmación del máximo de productos de lanzamiento                                                 | `ci:server`                           | `packages/server/scripts/run-store-profile-gate.mjs` → vitest aislado          |
| Ventana DOM de tabla virtualizada con un espécimen real de 1,000 filas                                                       | E2E web local                         | `e2e/web/design-system-scale.spec.ts`                                          |
| Heap retenido, documentos, nodos DOM y listeners en el mismo renderizador tras ciclos de jornada prolongada                  | E2E web local opcional                | `e2e/web/long-shift-soak.spec.ts`                                              |
| Respaldo cifrado en streaming de 256 MiB + RSS, creación/extracción de tienda y cola de ciclo de vida acotada                | `ci:desktop`                          | `profile-backup-streaming.mjs` + pruebas Node de escritorio                    |
| Memoria principal + renderizador de Electron e inicio del entorno compilado (estricto en CI; advertencia inicial local)      | `ci:desktop`                          | `scripts/run-electron-memory-gate.mjs` → `scripts/check-electron-memory.mjs`   |
| Métricas web de Lighthouse (LCP / TTI / CLS / puntuación) para rutas principales (estricto en CI; advertencia inicial local) | `ci:web` + `pnpm run perf:lighthouse` | `scripts/run-lighthouse-gate.mjs` → `scripts/check-lighthouse.mjs`             |

La línea base exigible localmente cubre tamaño de bundles, latencia p95 de tRPC
con fixtures y volumen de tienda, búsqueda literal en tres escalas de catálogo,
renderizado acotado de tablas de datos, importación de lanzamiento, recuperación
cifrada, memoria/inicio de Electron y métricas web de Lighthouse. Cada presupuesto
exigido hace fallar su verificación cuando hay una regresión.

Los textos de Operaciones fiscales acompañan a su panel ya diferido mediante el
espacio de nombres separado `fiscalOperations`, en lugar de aumentar cada visita
a la página inicial de Operaciones. La compilación local de 2026-09-03 midió
7.85 KiB gzip para el diccionario mayor de Operaciones y 8.35 KiB para los errores
de arranque en inglés. No se aumentaron los límites existentes ni la tolerancia
de cinco por ciento; el recorrido de recuperación fiscal en navegador también
ejercita el renderizado EN/ES bajo demanda.

### Responsabilidad de traducciones de la ruta inicial y estructura principal

El marco siempre montado debe resolver sus textos desde los espacios de nombres
de arranque, incluso cuando su resultado final sea nulo para un rol o entorno.
La insignia de contingencia fiscal y el aviso de actualización de escritorio
usan las entradas pequeñas de `common`; no deben suspender toda la estructura
principal para obtener los diccionarios fiscales o de configuración de empresa.
La prueba de regresión de estructura principal con i18n aislado omite
intencionalmente esos recursos y ejercita advertencias, verificación, reinicio y
errores recuperables en EN/ES.

La ruta de ventas inicia sus espacios de nombres iniciales junto con su módulo
diferido, no desde un efecto posterior a un renderizado suspendido. El acceso
rápido conserva su propio límite de carga diferida para que sus observadores de
catálogo no entren en el commit inicial del carrito. Historial, diálogos, Table
y PDF también siguen diferidos. Los diez diccionarios pequeños de soporte del
POS comparten un chunk por idioma; el diccionario de ventas más grande sigue
acotado de manera independiente. Esto reduce las solicitudes de módulos pequeños
sin cambiar el límite existente de ventas. Los nuevos chunks de soporte tienen
límites explícitos de 11/11.6 KiB; no se aumenta ningún presupuesto ni tolerancia
existentes. Otras rutas que usan clientes, promociones o restaurantes también
cargan el chunk de soporte de ese idioma, por lo que la calificación mide todas
las rutas. Las pruebas de regresión de artefactos exigen que ningún chunk de
soporte alcance el grafo estático de la estructura principal o del POS inicial y
que EN/ES permanezcan separados.
La precarga de espacios de nombres nunca inicia consultas de negocio ni omite
restricciones de sede/rol. `useTranslation` conserva la autoridad sobre cambios
de idioma y fallos de carga. Los resúmenes del carrito se memoizan por ítems
inmutables y modo de precios para que las actualizaciones de consultas ajenas no
serialicen otra vez la misma proyección de Customer Display. La publicación de
latidos y reconexiones no cambia. Lighthouse también registra eventos acotados
de CPU del renderizador, con identificadores opacos de scripts locales al proceso
y sin argumentos de traza ni encabezados sin procesar. Solo reciben un
identificador las URL canónicas del mismo origen verificadas contra archivos
regulares `assets/*.js` del nivel superior de la compilación actual; las
compilaciones faltantes, consultas, fragmentos, orígenes externos y assets con
enlaces simbólicos quedan sin atribuir. El arranque y la CPU comparten el mismo
resolvedor para correlacionar identificadores dentro de una ejecución. El mapeo
inverso permanece privado y los identificadores no son estables entre procesos.
La verificación aislada proporciona su propio directorio de compilación de vista
previa al resolvedor en vez de inspeccionar dist de un checkout anterior; los
diagnósticos de vista previa externa pueden especificar
`PUNTOVIVO_LIGHTHOUSE_BUILD_DIRECTORY`. Ningún canal de diagnóstico muestra
nombres ni rutas de scripts.
Cada muestra también registra puntuación, LCP, TTI y CLS antes de la agregación.
La atribución de CPU usa el procesador de trazas de la versión fijada de
Lighthouse para seleccionar los hilos del renderizador del frame principal
auditado, incluidos cambios de proceso; excluye tareas iniciadas antes de la
navegación medida. Los ocho eventos completos de CPU compatibles más largos son
ejemplos diagnósticos, no un total aditivo de CPU. La salida incluye
`cpuAttribution: main-frame`, o `unavailable` con una lista vacía si no están
disponibles la identidad o el análisis de traza. No se registran trazas ni errores
del parser sin procesar. Esta API interna de Lighthouse está aislada en los
diagnósticos y cubierta por pruebas sintéticas de múltiples renderizadores;
revalídala al actualizar Lighthouse. Su fallo nunca cambia métricas, muestreo,
mínimos de puntuación ni la política estricta de aceptación.

Los diagnósticos LCP exponen solo una etiqueta de elemento permitida y las cuatro
subpartes de traza observadas por el análisis de desglose de la versión fijada
de Lighthouse. Las subpartes faltantes o inválidas permanecen nulas; Lighthouse
omite ambas subpartes de recurso cuando el elemento LCP no carga un recurso,
como ocurre con texto. Una prueba crea los detalles con los productores fijados
de Lighthouse, por lo que debes revalidarla al actualizarlo. Nunca se incluyen
texto de nodos, selectores, etiquetas, atributos ni URL de recursos. Estos tiempos
observados no se suman a la auditoría LCP ajustada por simulación que usan las
verificaciones de puntuación y presupuesto; no cambian mediciones, umbrales ni aceptación.

### Contrato de interfaz a escala de datos

Base 08 de `/design-system` renderiza el `DataTable` de producción con el número
determinista de filas declarado en
`perf-budget.json::dataScale.designSystemRows` (actualmente 1,000). No es una
maqueta dibujada: el espécimen usa el mismo ordenamiento, filtrado, tabla densa,
foco de teclado móvil y ventana de `@tanstack/react-virtual` que las pantallas
de catálogo e inventario.

`e2e/web/design-system-scale.spec.ts` lee el mismo contrato JSON y demuestra
cuatro invariantes visibles para el operador:

1. La tabla entra automáticamente en modo virtualizado.
2. Las filas reales montadas permanecen en o por debajo de
   `dataScale.maxMountedRows`, mientras las 1,000 filas siguen siendo accesibles.
3. El filtrado puede localizar la parte final de los datos sin cambiar de
   pantalla ni perder el contrato del total de filas.
4. `End` mueve el foco del teclado a través de la ventana virtual hasta la última
   fila mientras se conserva el límite de filas montadas.

La prueba también aplica el rastreador estándar de incidencias del cliente, por
lo que errores de consola o de página, solicitudes fallidas y respuestas HTTP
inesperadas hacen fallar la evidencia. Es una verificación E2E local por política
del repositorio; `ci:web` sigue cubriendo los contratos de componentes, tipos,
compilación, bundles, contraste, adaptación y Lighthouse.

### Contrato de jornada prolongada en el mismo renderizador

`pnpm run test:e2e:web:soak` maneja un solo renderizador Chromium autenticado a
través de los ciclos repetidos de montaje/desmontaje y consultas declarados en
`e2e/web/long-shift-soak.spec.ts`. Cinco ciclos de calentamiento llenan las
cachés finitas de rutas y TanStack Query antes de la línea base. Luego, treinta
ciclos medidos abren y cierran superficies de creación de productos, detalles de
productos e historial de ventas sin recargar el documento.

En la línea base y cada diez ciclos, el ejecutor solicita GC dos veces alrededor
de un breve período de estabilización, lee `Runtime.getHeapUsage` y lee
`Memory.getDOMCounters`. `perf-budget.json::longShiftSoak.maxGrowth` se aplica a
la muestra final menos la línea base: 4 MB de heap usado, un documento, 100 nodos
y ocho listeners. Los puntos intermedios quedan en la evidencia JSON, pero no
hacen fallar la verificación; las asignaciones temporales que desaparecen con el
GC forzado final no son fugas retenidas. Las ejecuciones locales iniciales de
referencia retuvieron 0.64-0.83 MB y cero documentos, nodos o listeners, dejando
un margen de heap de aproximadamente cinco veces lo observado.

El mismo recorrido valida un ciclo de vida concreto de alto riesgo: instrumenta
la API de URL Blob del navegador, abre OCR de compras, mantiene la solicitud real
de carga en curso, cierra el diálogo y exige que la URL de vista previa creada
se revoque antes de liberar la respuesta exitosa. Esto detecta regresiones de
propiedad de recursos y asincronía obsoleta que una cifra de heap sola no permite diagnosticar.

La prueba prolongada real es opcional y está excluida de la suite funcional
habitual y de CI de pushes. `ci:web` sí ejecuta
`long-shift-memory.test.mts` y `long-shift-soak-contract.test.mjs`, que fijan las
matemáticas de comparación, cobertura de métricas, estructura del presupuesto,
etiquetas, ejecución serial y la exclusión de la prueba prolongada de la suite
normal. RSS e inicio del proceso principal/renderizador de Electron siguen a
cargo de la verificación separada del entorno compilado más adelante.

### Contrato SQLite con volumen de tienda

`__tests__/perf-store-profile.test.ts` convierte la carga determinista `mega` en
un contrato de CI del servidor en vez de una demostración visual. La prueba se
niega a medir hasta que un tenant tenga al menos 500 productos, 80 clientes,
800 ventas, 2,500 movimientos de inventario, 12 pedidos, 900 eventos de auditoría y
150 asientos de cuenta corriente de clientes. La carga también demuestra que
cada venta a crédito tiene un asiento de cuenta por cobrar de solo anexado y
que las ventas a crédito reembolsadas o anuladas quedan en cero neto mediante
asientos de reversión.

La suite habitual de cobertura ve intencionalmente este archivo como omitido.
Un p95 de tiempo real registrado mientras cientos de archivos de prueba compiten
entre workers mide el planificador de pruebas y no la lectura de SQLite. Tras
completar la cobertura, `packages/server/scripts/run-store-profile-gate.mjs`
inicia un proceso Vitest portable de un solo worker con el indicador explícito
de activación. `ci:server` falla si falla la cobertura o este perfil aislado.

Después de cinco calentamientos, la suite mide 20 invocaciones reales del caller
tRPC para cada lectura frecuente y calcula p95. Las líneas base versionadas son
10 ms para ventas y movimientos de inventario; 15 ms para stock y auditoría;
20 ms para sugerencias de reposición; 8 ms para lista/saldo de cuenta corriente; y 60 ms para vista previa del cierre
diario. La carga completa tiene una línea base de tiempo de 4,000 ms. Cada valor
recibe el margen de variación del runner de 30% del perfil de tienda.

La misma prueba ejecuta `EXPLAIN QUERY PLAN` y exige los índices de tenant/fecha
para ventas, movimientos de inventario, cuenta corriente de clientes y registros
de auditoría. Esto detecta regresiones del planificador incluso cuando una
máquina de desarrollo rápida todavía las oculta. Una ejecución local aislada de
referencia del 2026-07-22 produjo 500 productos, 80 clientes, 844 ventas,
3,501 movimientos de inventario, 925 registros de auditoría y 216 asientos en
885 ms. Sus p95 medidos fueron de 0.06 ms para saldo de cuenta corriente a
4.88 ms para vista previa del cierre diario. Una ejecución diagnóstica con
cobertura paralela infló p95 individuales en mucho más de un orden de magnitud.
Por eso, el perfil exigido se ejecuta después de la cobertura del servidor en
su propio proceso, y los comandos raíz `ci:web`/`ci:server`/`ci:desktop` deben
ejecutarse secuencialmente en un host en vez de debilitar los presupuestos para
absorber contención ajena del planificador.

Este contrato completa la lectura del servidor del perfil de volumen de tienda.
Las mediciones de escritura/recuperación y de escritorio compilado que siguen
son perfiles operativos separados; no deduzcas tiempos de paquetes firmados ni
dispositivos físicos a partir de la verificación SQLite en memoria.

### Contrato de escala de búsqueda de productos

`__tests__/perf-product-search-profile.test.ts` hace crecer el mismo catálogo
determinista de tenant a 1,000, 10,000 y 50,000 productos dos veces, una por
configuración de tenant, cada una en su propia base SQLite en memoria: un catálogo
minorista sin perfil de farmacia y un catálogo de farmacia con un perfil uno a
uno en cada producto. El perfil se ejecuta después de las verificaciones
habituales de cobertura y tienda en su propio proceso Vitest de un solo worker.
Esto evita el grupo paralelo de cobertura en las muestras de tiempo real y
también ejercita los mismos triggers FTS incrementales de las escrituras reales
de productos.

Las configuraciones usan bases separadas para medir cada presupuesto sobre los
datos que protege. En runners alojados, el contenido de perfiles hace que FTS
amplio y el grupo híbrido sean aproximadamente 20% más lentos. La configuración
de farmacia agrega además una vía de metadatos regulados que cuesta unas 2.5
veces la subcadena de catálogo. Un único fixture mixto cargaría a los comercios
minoristas el costo de los datos farmacéuticos o permitiría ocultar una regresión
de farmacia bajo el margen minorista. Dentro de una ejecución alojada, la vía de
subcadena genérica cuesta lo mismo en ambos catálogos.

Cada configuración exige paridad de cardinalidad de perfiles/FTS en cada escala:
sin perfil para comercio minorista y uno por producto para farmacia. La creación
del catálogo minorista y la incorporación de perfiles farmacéuticos tienen
presupuestos de tiempo separados en cada escala para que una futura regresión
de trigger o escritura de perfiles no se oculte en el timeout de prueba. Luego,
la verificación maneja el procedimiento tRPC de producción `products.search`
tras tres calentamientos descartados. Ambas configuraciones miden:

1. resolución exacta de SKU mediante el índice tenant/código;
2. búsqueda selectiva de prefijos de varios tokens mediante FTS5;
3. un prefijo amplio de dos tokens que coincide con todo el catálogo generado; y
4. una subcadena interna de un token que llega deliberadamente al mecanismo de
   compatibilidad `LIKE`.

La configuración de farmacia agrega:

5. búsqueda de prefijo de principio activo mediante la vía FTS de farmacia;
6. búsqueda exacta de registro sanitario mediante su índice por tenant; y
7. un fragmento interno de token del principio activo exclusivo de farmacia que
   llega a la vía `LIKE` con unión de metadatos regulados.

Los límites de búsquedas exactas, FTS y grupo híbrido provienen de `p95` para
ambas configuraciones. Solo las vías de subcadenas tienen presupuesto por
configuración: el catálogo minorista responde a `p95.substringFallback`, mientras
que las subcadenas genéricas y de metadatos del catálogo farmacéutico responden
a `pharmacyP95`. Las búsquedas de enrutamiento de cocina se ejecutan sobre el
catálogo minorista. Los procedimientos de catálogo y búsqueda literal evalúan
metadatos regulados solo para un tenant con perfil de farmacia, por lo que un
tenant minorista nunca paga esa consulta de unión.

El mismo proceso también llama directamente al servicio híbrido de candidatos de
producción con una consulta amplia. Exige exactamente 200 candidatos FTS seguros
por tenant y mide ese grupo independientemente sin llamar a un proveedor de
embeddings. Esto fija el límite de memoria de solicitudes D1 y mantiene el
tiempo determinista y libre de latencia del proveedor.

Cada consulta recibe 30 muestras registradas y un límite p95 de
`perf-budget.json::productSearchProfile`. La verificación también exige identidad
exacta de resultados para las búsquedas selectivas, el límite de resultados
configurado para búsquedas amplias, rechazo de una colisión idéntica de SKU/nombre
entre tenants, una fila FTS por producto vendible del tenant, comprobación de
integridad FTS exitosa y un plan de consulta con tabla virtual más clave primaria
de producto. Así falla ante cambios de relevancia o aislamiento incluso si una
máquina rápida oculta la regresión de tiempo. Treinta muestras independizan el
p95 interpolado de una única pausa máxima; las muestras lentas repetidas siguen
fallando el presupuesto, mientras un valor atípico del planificador o GC no puede
aparentar una regresión sostenida de búsqueda.

La referencia de búsqueda literal del 2026-08-08 midió creación acumulada del
catálogo de 22.93 ms, 235.12 ms y 1,266.25 ms. El p95 de FTS amplio escaló de
1.51 ms a 9.48 ms y 47.30 ms; el SKU exacto quedó en o por debajo de 0.86 ms,
FTS selectivo en o por debajo de 1.59 ms y la alternativa de subcadena en o por
debajo de 7.42 ms. Dos ejecuciones locales secuenciales de PR9 del 2026-09-02
incorporaron perfiles de farmacia en como máximo 34.02 ms, 351.47 ms y
1,662.49 ms. Esa fase reutiliza las líneas base existentes de creación de catálogo
de 200/800/4,000 ms en vez de introducir un contrato de host más permisivo.
La separación del 2026-09-11 se recalibró con dos ejecuciones alojadas secuenciales
de Backend Server y un control estable del perfil de tienda. En 50k, el p95 de
subcadena de catálogo minorista y farmacéutico quedó dentro de 19.85 ms, y el de
metadatos exclusivos de farmacia, dentro de 50.11 ms. Ejecuciones alojadas
anteriores de la misma vía de 50k, con código sin cambios, midieron 20.13, 26.05,
27.94 y 28.14 ms. Por tanto, el presupuesto de subcadena de 50k sigue ese máximo
de 28.14 ms y no una sola ejecución: 23 ms antes de tolerancia, para ambas
configuraciones y para enrutamiento de cocina, que lo reutiliza. La vía de
metadatos sigue sus propios máximos alojados (4, 9.5 y 41 ms) y nunca queda por
debajo del presupuesto de subcadena minorista de la misma escala.
Las líneas base versionadas conservan margen para el runner y luego aplican la
tolerancia compartida de 35%. Son presupuestos de regresión, no SLA de latencia
para usuarios.
La referencia de candidatos híbridos acotados del 2026-08-09 midió p95 de 1.12 ms,
8.55 ms y 43.67 ms en 1k, 10k y 50k; sus límites versionados son 5 ms, 20 ms y
100 ms antes de la misma tolerancia.

La consulta FTS amplia tiene una calibración separada entre hosts. Dos ejecuciones
secuenciales de Backend Server en `ubuntu-latest` para PR 197 midieron máximos
p95 de 6.61 ms en 1k, 28.95 ms en 10k y 136.50 ms en 50k; la segunda se detuvo
en la aserción de 10k, por lo que la observación de 50k proviene de la primera.
La versión 4 del presupuesto aumenta solo las líneas base de consulta amplia a
5.5 ms, 24 ms y 110 ms y conserva la tolerancia existente de 35%. Por tanto, los
límites exigidos son 7.43 ms, 32.40 ms y 148.50 ms: menos de 13% por encima de
los máximos observados en runners alojados y aún acotados independientemente de
búsquedas exactas, selectivas, alternativas y de candidatos semánticos. La
recalibración debe usar un perfil serial en el host CI de destino y conservar las
mediciones en el PR que cambia el presupuesto; no aumentes la tolerancia compartida
para ocultar una configuración de consulta ni calibres solo en una máquina de
desarrollo más rápida.

### Contrato de escala de cadenas de auditoría

`__tests__/perf-audit-chain-profile.test.ts` crea una cadena en archivo de
100,000 filas de tenant y ejecuta el verificador de producción y la reescritura
de redacción de privacidad en un proceso aislado de un solo worker. La
verificación recorre hacia atrás desde la cabecera persistida en páginas de
512 filas forzadas a usar `idx_audit_logs_chain_hash`, calcula hashes de cadenas
grandes en un worker de corta vida y cede la ejecución entre páginas. La prueba
exige que se ejecute un temporizador durante el recorrido, por lo que un futuro
bucle síncrono sobre todo el historial no puede pasar solo por tiempo total.

La redacción permanece deliberadamente en la transacción de escritura
BetterSQLite3 del caller: la disposición de PII, reescritura completa de cadena,
reserva de ancla y CAS de cabecera aún se confirman o revierten juntas. Una tabla
temporal de recorrido local a la conexión y un cursor de profundidad acotado
reemplazan la antigua copia JavaScript de todas las filas. Su profundidad es la
única clave temporal: el id de auditoría de origen ya es globalmente único y el
recorrido verificado de enlaces/conteo rechaza ciclos, por lo que duplicar todos
los ids en un segundo índice UNIQUE en memoria no aporta evidencia de integridad.
El primer perfil adversarial expuso un crecimiento RSS de 758.98 MiB y una
reescritura de 2,964.22 ms. Tras acotar la implementación y corregir el cálculo
RSS para usar una línea base posterior a la carga en ambas etapas, la validación
serial en el mismo host local midió crecimiento acumulado de maxRSS de
140.61–143.48 MiB, redacción de 1,099.73–1,118.48 ms y verificación de
377.41–380.30 ms. La verificación también demuestra que las tablas temporales se
eliminan tanto en éxito como en corrupción con rechazo seguro. Una calificación
posterior en la misma máquina Apple Silicon midió 155.91 MiB y 832.46 ms tras
eliminar ese índice redundante, dentro de los presupuestos absolutos y de tiempo sin cambios.

`perf-budget.json::auditChainProfile` conserva margen para runners portables en
vez de presentar esta ejecución Apple Silicon como calibración alojada. Debe
conservarse la primera medición de CI del PR con su clase de runner; ajusta una
línea base solo con evidencia serial repetida en esa clase, nunca aumentando la
tolerancia compartida ni ejecutando este perfil junto a otra verificación de rendimiento.

### Evidencia de almacenamiento vectorial y modelos de productos

Dos benchmarks invocados por el operador permiten revisar cambios de vectores/modelos
sin agregar ruido del proveedor o del host al CI habitual:

- `pnpm --filter @puntovivo/server run benchmark:vector-storage` compara
  decodificación determinista de JSON decimal y `PVEC` float32 portable más
  clasificación por coseno sobre el límite de producción de 200 candidatos.
  Cubre 384–4,096 dimensiones, 30 muestras, bytes de almacenamiento, p95,
  recall@10 y error máximo de similitud.
- `pnpm --filter @puntovivo/server run benchmark:product-embeddings -- --models=<comma-separated-models>`
  genera embeddings del corpus versionado de 36 productos y 24 consultas con
  Ollama local. Registra nDCG@10, recall@3, MRR, top-1, evidencia completa de los
  diez primeros, dimensiones, latencia observada de lotes/calentamiento, digest
  del modelo instalado y almacenamiento JSON/PVEC.

Usa `--output=<path>` para conservar un informe. La evidencia versionada del
2026-08-09 está en `docs/assets/benchmarks/`; una prueba del servidor la vincula
al SHA del corpus, el valor predeterminado de Ollama seleccionado, la versión
del códec y el límite de producción de 200 candidatos. Los ejecutores no registran
hostname. El calentamiento de Ollama depende de caché, orden y host, y constituye
evidencia diagnóstica, no un mínimo estricto de latencia.

En 768 dimensiones, la ejecución de almacenamiento conservada midió 3,084 bytes
y p95 de decodificación/clasificación de 0.4993 ms por grupo de 200 vectores para
`PVEC`, frente a 16,159.09 bytes y 5.2705 ms para JSON decimal, con recall@10 de
1.0. El corpus de dominio conservado seleccionó `embeddinggemma` con nDCG@10
0.961299 y recall@3 1.0. Son observaciones para seleccionar arquitectura, no
clasificaciones universales de modelos ni promesas de nivel de servicio para
usuarios. Consulta [ADR-0011](../architecture/0011-product-search-vectors.md).

### Contrato de continuidad operativa

`perf-budget.json::operationalProfile` extiende el perfil de tienda más allá de
las lecturas frecuentes:

- El ejecutor aislado del servidor previsualiza y confirma el máximo de
  transporte de 500 filas de productos de lanzamiento mediante el caller tRPC
  real. Las líneas base versionadas son 750 ms para vista previa y 2,500 ms para confirmación.
- Las pruebas Node de escritorio crean una base SQLCipher cifrada de 5,000 filas,
  generan un ZIP de respaldo de producción, lo extraen, ejecutan validación de
  integridad con la misma clave y verifican el total de filas. Creación y
  extracción tienen cada una una línea base de 2,500 ms.
- `ci:desktop` también ejecuta el flujo de streaming de producción en un worker
  aislado contra una base cifrada de 256 MiB. Su máximo RSS registrado por el SO
  debe permanecer en o por debajo de 256 MiB y crecer como máximo 96 MiB desde
  la línea base posterior a la carga. Antes de esa línea base de crecimiento se
  realiza un calentamiento completo de 1 MiB, por lo que las áreas fijas de
  SQLCipher/ZIP/JIT siguen cubiertas por el límite absoluto, mientras el
  crecimiento mide el escalamiento de la carga útil. Esto detecta picos nativos
  síncronos de SQLite que un temporizador del bucle de eventos no puede observar.
  `pnpm run perf:backup:release` ejecuta localmente la misma ida y vuelta estricta
  con una base de 1 GiB; su costo es deliberadamente excesivo para cada runner de push.
- La FIFO de ciclo de vida de la base acepta como máximo 16 operaciones de
  respaldo/restauración pendientes. Una solicitud número diecisiete se rechaza
  explícitamente en vez de retener closures sin límite mientras el servidor embebido está detenido.
- La verificación de memoria de Electron registra tiempo real alrededor del
  mismo arranque del entorno compilado que produce métricas reales del proceso
  principal/renderizador. Su línea base de 20,000 ms incluye inicio del servidor
  embebido, creación de ventana, carga del renderizador, período de
  estabilización de la medición y cierre ordenado.

Las líneas base de tiempo comparten un margen de variación del runner de 35%;
los límites RSS de streaming y el límite de cola son exactos. Son
presupuestos de regresión, no promesas de servicio. El inicio de instaladores
firmados y la recuperación con volumen de producción en Linux, macOS y Windows
siguen requiriendo evidencia de candidato a release porque el entorno compilado
de CI no es un artefacto empaquetado ni firmado.

### Memoria e inicio del entorno compilado de Electron (estricto en CI, advertencia inicial local)

`scripts/check-electron-memory.mjs` inicia la app Electron compilada con
`PUNTOVIVO_MEASURE_MEMORY=1`. El proceso principal espera a que termine la carga
del renderizador más un breve período de estabilización, lee el conjunto de
trabajo de cada proceso Electron con `app.getAppMetrics()`, imprime una línea
`PUNTOVIVO_MEMORY_METRICS=<json>` y sale. La verificación asigna el proceso
`Browser` a `main` y el proceso `Tab` a `renderer` (excluye GPU y procesos de
utilidad), los suma en MB y compara contra
`perf-budget.json::electronMemoryMb.perProcessMb` con el `thresholdPercent`
compartido. El lanzador también registra el tiempo real total y lo verifica
contra `operationalProfile.desktopLaunchElapsedMs`.

`ci:desktop` compila el bundle web más el bundle principal/preload de Electron,
inicia una vista previa Vite local mediante
`scripts/run-electron-memory-gate.mjs`, apunta `WEB_DEV_SERVER_URL` a ese
renderizador y ejecuta la comprobación de memoria con `--strict` y
`--require-measurement`. La vista previa reutiliza el punto de entrada real del
ejecutable pnpm (`npm_execpath`), iniciando entradas JavaScript mediante Node y
binarios nativos directamente sin shell. En Windows, inicia este ejecutor con
`pnpm run perf:electron-memory:gate` en vez de invocar un wrapper `.cmd`/`.bat`;
si falta una entrada utilizable, falla de forma segura. En ubuntu, el trabajo
de escritorio de GitHub Actions instala `xvfb` y el lanzador envuelve Electron
con `xvfb-run -a`, por lo que CI mide el renderizador Chromium real en vez de la
página de error. Dos clases de fallo interrumpen la compilación:

- **Regresión.** Un proceso principal o renderizador por encima de
  `budget * (1 + thresholdPercent/100)` termina con código 1 en `--strict`.
- **Falta de evidencia.** La ausencia del bundle principal `.vite/build`, un
  binario Electron no resoluble, fallo de inicio, renderizador no montado, falta
  de línea de métricas o ausencia de un proceso presupuestado terminan con
  código 1 en `--require-measurement`.

El script directo local sigue siendo tolerante para diagnósticos del operador:

- **Advertencia inicial.** Un proceso por encima del límite imprime `WARN` y
  sigue terminando con código 0. Pasa `--strict` (o
  `PUNTOVIVO_MEMORY_STRICT=1`) para que una regresión termine con código 1.
- **Omisión automática.** Si falta el bundle principal `.vite/build`, el binario
  electron no se puede resolver, hay error de inicio o no vuelve una línea de
  métricas, imprime `WARN: skipped` y termina con código 0 salvo que esté
  presente `--require-measurement` (o `PUNTOVIVO_MEMORY_REQUIRE_MEASUREMENT=1`).

Los helpers puros de comparación/análisis tienen pruebas unitarias en
`scripts/check-electron-memory.test.mjs` y el ejecutor portable de vista previa
queda fijado por `scripts/run-electron-memory-gate.test.mjs`; ambos se ejecutan
antes del inicio real de medición de memoria en `ci:desktop`.

### Métricas web de Lighthouse (estricto en CI, advertencia inicial local)

`scripts/run-lighthouse-gate.mjs` es el ejecutor de CI. Garantiza que exista
Chromium de Playwright, prepara una base SQLite demo aislada, compila un bundle
web privado dirigido a un puerto API dedicado, inicia el servidor API autónomo
más la vista previa Vite en puertos separados de la pila habitual de desarrollo
e invoca `scripts/check-lighthouse.mjs --strict --require-measurement`. La
comprobación mide la experiencia de carga del frontend —LCP, TTI, CLS y
puntuación de rendimiento Lighthouse— para las rutas principales orientadas al
usuario (`authenticatedBoot`, `/dashboard`, `/sales`, `/products`).
`authenticatedBoot` lleva un navegador ya autenticado a `/login` y mide el
arranque resultante de la aplicación tras la redirección canónica; **no** afirma
medir la entrada de credenciales ni la pantalla anónima de inicio de sesión.
La evidencia histórica de esquema v1 llamaba `login` a esta ruta; el esquema v2
normaliza esa clave antigua al leer, mientras la evidencia actual debe usar
`authenticatedBoot`. Las mediciones se comparan contra
`perf-budget.json::lighthouse.perRoute` con el `thresholdPercent` de la sección.
Las métricas `lower-is-better` (tiempos, desplazamiento de diseño) presentan
regresión al superar `budget * (1 + t/100)`. La puntuación `score` ya es un
mínimo de calidad normalizado de 0-100. Mantiene visible ese mínimo declarado y
usa solo la banda absoluta `scoreTolerancePoints`; aplicarle el porcentaje de
duración debilitaría mucho el mínimo aparente. La verificación también rechaza
una distribución de puntuación cuyo rango intercuartílico supere
`maxScoreIqrPoints` **y** cuyo rango observado cruce el mínimo exigido, para que
un host con contención no convierta evidencia inconclusa en aprobación o regresión
del producto. Una distribución ruidosa cuyas muestras permanezcan todas del mismo
lado es concluyente; el informe la mantiene visible sin hacer fallar la verificación.

Cómo funciona una ejecución:

1. Verifica los puertos API, vista previa y CDP antes de la preparación y luego
   vuelve a validar cada puerto justo antes de iniciar el proceso propietario.
   La compilación aislada recibe un nonce criptográficamente aleatorio de
   propiedad en un asset estático dedicado; la disponibilidad de la vista previa
   exige ese nonce exacto, no solo una respuesta HTTP exitosa. Así, no se puede
   aceptar un listener obsoleto o ajeno como candidato bajo prueba.
2. Inicia Chromium real mediante Playwright con un puerto CDP. El ejecutor
   monitorea API y vista previa durante toda la vida del proceso hijo Lighthouse
   y termina la auditoría inmediatamente si sale cualquiera de los servicios propios.
3. Inicia sesión UNA VEZ (administrador de la carga demo de `docs/DEV-SEED.md`).
   El token de actualización queda en una cookie httpOnly; el token de acceso en
   memoria se vuelve a emitir mediante `auth.refresh` en cada navegación, de
   modo que las rutas autenticadas se miden correctamente con `disableStorageReset:true`.
4. Calienta cada ruta antes de las auditorías medidas. El ejecutor aislado sirve
   una vista previa de producción; el comando diagnóstico directo también puede
   dirigirse a un servidor de desarrollo. Mantén distintos esos contextos de
   host y compilación al comparar resultados.
5. Ejecuta Lighthouse `samplesPerRoute` veces por ruta. La política exige un
   número impar de muestras de 5 a 9; la configuración versionada usa cinco
   auditorías completas por ruta.
6. Reduce cada métrica a su mediana y conserva mínimo, máximo y rango
   intercuartílico de Tukey de la puntuación. Exigir cada muestra evita ocultar
   auditorías faltantes, mientras la mediana elimina picos aislados del planificador de CPU.
7. **Extensión adaptativa.** Cuando el IQR de puntuación de cinco muestras supera
   `maxScoreIqrPoints` **y** el rango observado cruza el mínimo exigido —la misma
   condición que rechazaría la ejecución por inestable—, la ruta se extiende a
   `maxSamplesPerRoute` auditorías completas (impar, actualmente siete) y se
   vuelve a agregar antes de juzgar. La extensión reúne evidencia, no agrega
   tolerancia: mínimos, límite IQR y regla de cruce permanecen iguales, y una
   distribución que sigue siendo amplia a través del límite tras siete muestras
   sigue rechazándose. Deliberadamente **no** extiende una distribución amplia
   pero concluyente (volátil): esa ejecución ya pasa, por lo que más muestras
   solo podrían llevar su mínimo por debajo del umbral y convertir una aprobación
   en rechazo. La extensión nunca debilita la evidencia inicial: si falla una
   auditoría extra o devuelve un resultado parcial que anularía una métrica de
   toda la ruta, se juzga la distribución original de cinco muestras, de modo
   que un conteo parcial nunca pase como evidencia completa.
8. Compara tiempos y CLS con su variación porcentual y puntuación con su banda
   absoluta actual de cinco puntos. Rechaza evidencia faltante o un rango de puntuación
   de IQR alto que cruce el mínimo exigido; informa rangos de IQR alto del mismo
   lado como volatilidad concluyente.

Cada ejecución imprime un perfil de host no identificatorio junto a la
distribución: clase de runner, versión de SO, arquitectura, versión de Node,
número de CPU lógicas, modelo de CPU y memoria. Omite deliberadamente el
hostname. Conserva esa línea al comparar calibración local y de runners
compartidos; una puntuación sin clase de host no es evidencia portable.

La banda de puntuación se calibra con evidencia de la línea de release y no solo
con la máquina del desarrollador. Las siguientes observaciones de banda de dos
puntos describen versiones anteriores del presupuesto, no la banda actual de
aceptación de cinco puntos. Runners compartidos anteriores midieron la
ruta de ventas en 69, 71 y 72, incluido un par de reejecuciones 69/71 del mismo
commit de PR, mientras las medianas locales repetidas fueron 74–75. El
2026-08-25, PR 202, solo de release, produjo dos medianas concluyentes de 67 en
runners AMD EPYC 7763: una distribución de cinco muestras 66–70 con IQR 2.5,
seguida de una distribución adaptativa de siete muestras 59–71 con IQR 2. El PR
209 adyacente con la misma aplicación midió 74 en un runner AMD EPYC 9V74, y el
head exacto de PR 202 midió 77 localmente; las medianas LCP remotas de ventas
permanecieron saludables en 3.06 s y 3.05 s.

La versión 5 del presupuesto bajó solo el mínimo declarado de ventas de 70 a 69
conservando la banda entonces vigente de dos puntos, por lo que su mínimo exigido era 67. La
versión 6 cambia `login` a `authenticatedBoot` sin cambiar ningún umbral. Ese cambio histórico fue una
calibración específica de ruta para runners lentos, no una excepción por modelo
de CPU. En cambio, la versión actual 8 usa una banda absoluta de cinco puntos y
conserva el mínimo declarado de ventas de 69, por lo que falla una mediana de
ventas inferior a 64. La calibración conservada de versión 8 registra puntuaciones
consecutivas de 73 y 66 para una compilación web idéntica en bytes en PR 230, con
IQR 1 en ambas ejecuciones, y bundles de ventas adyacentes sin cambios con
puntuaciones de 70 y 65. El registro no proporciona fecha de medición. Este
cambio entre ejecuciones movió toda la distribución y no era visible para la
regla IQR dentro de cada ejecución. Por eso, la banda actual detecta regresiones
grandes de puntuación; los presupuestos de bundles y tiempos conservan cobertura
independiente. La comprobación también registra índices de benchmark de CPU de
Lighthouse por muestra para respaldar futuras comparaciones en el mismo host.
El informe imprime los límites declarado y exigido. Un IQR superior a cuatro puntos rechaza la
ejecución solo cuando las muestras cruzan ese mínimo exigido; apunta a la
incertidumbre de decisión, no a castigar variación inocua lejos del límite.

El máximo adaptativo de siete muestras se calibró el 2026-08-13, cuando tres
ejecuciones en runners alojados de tres ramas fueron rechazadas por inestables,
aunque todas pasaron una reejecución simple: una muestra con contención cayó por
debajo del mínimo (rangos de dashboard 59–76 y ventas 63–74), mientras las medianas
permanecían 6–14 puntos por encima. Al reproducir esas distribuciones, dos muestras
adicionales cerca de la mediana llevan el IQR de Tukey dentro del límite y la
ejecución pasa por su propia evidencia; una ejecución realmente inconclusa —mediana
en el mínimo con un rango amplio persistente— sigue fallando tras siete muestras.
La extensión solo se activa ante un rango amplio que cruce el mínimo, por lo que
una ejecución estable y otra ruidosa con todas sus muestras del mismo lado
cuestan exactamente cinco auditorías como antes.

CI falla de forma estricta ante dos clases:

- **Regresión.** Una métrica fuera de presupuesto termina con código 1 en `--strict`.
- **Falta de evidencia o evidencia inconclusa.** Navegador faltante, servidor o
  vista previa detenidos, fallo de autenticación que impide cubrir rutas
  autenticadas, ruta faltante, métrica faltante, conteo de muestras incorrecto,
  distribución mal formada o rango de puntuación de IQR alto que cruce el mínimo
  exigido terminan con código 1 en `--require-measurement`.

El script directo local sigue siendo tolerante para diagnósticos del operador:

- **Advertencia inicial.** Una métrica fuera de presupuesto imprime `WARN` y
  sigue terminando con código 0. Pasa `--strict` (o
  `PUNTOVIVO_LIGHTHOUSE_STRICT=1`) para que una regresión termine con código 1.
- **Omisión automática.** Si Playwright/Lighthouse no están disponibles, la pila
  dev:web/dev:server no está activa o el navegador no inicia, imprime
  `WARN: skipped` y termina con código 0 salvo que esté presente
  `--require-measurement` (o `PUNTOVIVO_LIGHTHOUSE_REQUIRE_MEASUREMENT=1`).

Los helpers puros pasan por `ci:web` mediante
`scripts/check-lighthouse.test.mjs` y `scripts/run-lighthouse-gate.test.mjs` antes
del inicio real. La evidencia medida usa un sobre versionado
`{ schemaVersion, routes }`. Las cifras son de una compilación de vista previa
bajo la limitación simulada de Lighthouse, no telemetría de producción: la
verificación detecta regresiones respecto a la línea base versionada.

## Por qué importan los presupuestos

Puntovivo se entrega a comercios del perfil de cliente objetivo con hardware
Celeron antiguo o todo en uno con 4 GB. Un aumento de 50 KB del bundle o una
regresión de 60 ms en un procedimiento de lectura frecuente pasa inadvertido en
una estación rápida, pero ralentiza visiblemente el cobro en el equipo del
cajero. El presupuesto detecta la regresión al incorporar el PR y no cuando se
queja un cliente.

## Cómo se ejecutan las verificaciones

### Tamaño de bundles

`pnpm run ci:web` encadena:

1. Verificaciones compartidas y el ejecutor propio de auditoría de dependencias
   (`pnpm run ci:audit`), luego comprobación de tipos, lint, pruebas unitarias
   con cobertura y compilación.
2. `node --test scripts/check-bundle-size.test.mjs`: fija la expresión regular
   que elimina hashes y la lógica de comparación.
3. `node scripts/check-bundle-size.mjs`: lee `apps/web/dist/assets/*.js`, calcula
   el tamaño gzip de cada chunk, elimina el hash de contenido Rolldown (por
   ejemplo, `SalesPage-Br3xY9Q_.js` → `SalesPage`) y compara contra
   `perf-budget.json::bundleSize.perChunkGzKb`. Un chunk que supere
   `budget * (1 + thresholdPercent/100)` hace fallar la compilación con una
   tabla Markdown que indica el chunk infractor y su diferencia.

La integridad de la línea base forma parte de la verificación:

- Un chunk presente en la compilación de al menos `5 kB` gzip y ausente del
  presupuesto hace fallar la compilación. El mismo cambio debe agregar su línea
  base deliberada. Las divisiones de rutas menores y chunks pequeños de iconos
  permanecen sin controlar hasta crecer lo suficiente para justificar un límite explícito.
- Un chunk del presupuesto ausente de la compilación hace fallar la compilación.
  El mismo cambio debe eliminar o reemplazar la clave obsoleta para que la línea
  base nunca presente cobertura inexistente.

### Latencia p95 de tRPC

`pnpm run ci:server` ejecuta primero la suite funcional con cobertura y luego
`packages/server/scripts/run-trpc-latency-gate.mjs` inicia
`__tests__/perf-trpc-latency.test.ts` en un proceso Vitest dedicado de un worker.
El archivo del perfil se omite salvo que ese ejecutor establezca su indicador
explícito de activación. La prueba:

1. Inicia `createServer({ dbPath: ':memory:' })`.
2. Prepara 30 productos y 20 clientes para que los procedimientos seleccionados
   ejerciten resultados no vacíos.
3. Por cada clave de `perf-budget.json::trpcLatencyMs.p95`:
   - Ejecuta `warmupIterations` invocaciones (descartadas, para estabilizar JIT).
   - Ejecuta `samplesPerProcedure` invocaciones medidas con diferencias de
     `performance.now()`.
   - Calcula p95 con `computePercentile` (interpolación lineal).
   - Exige que p95 esté dentro de `budget * (1 + thresholdPercent/100)`.

Mitigaciones de variación del runner:

- El perfil nunca comparte un grupo de workers con cobertura ni con el perfil de tienda.
- El valor predeterminado de `warmupIterations` es 10.
- El valor predeterminado de `samplesPerProcedure` es 50.
- p95 (no p99): menos ruido de cola.
- Umbral de 20% sobre el presupuesto.

## Monitoreo de usuarios reales de Web Vitals (RUM)

> Estado: flujo de ingesta entregado. El dashboard de agregación queda pendiente.

Las verificaciones anteriores de tamaño de bundles y latencia tRPC son
sintéticas: miden la compilación y el servidor por separado. No pueden ver lo
que experimenta el navegador real del cajero en el hardware real. RUM cierra esa
brecha con mediciones de campo.

`apps/web/src/lib/observability.ts::installWebVitalsReporter()` conecta la
biblioteca `web-vitals` (LCP, CLS, INP, TTFB, FCP) al arrancar y reenvía cada
métrica finalizada a la mutación tRPC pública `observability.reportWebVital`,
que almacena una fila por métrica en `web_vital_samples` (`tenant_id`,
`tenant_plan`, `route`, `metric`, `value`, `rating`, `device_class`,
`created_at`). Propiedades del flujo:

- **Muestreo**: se decide una vez por carga de página (se reportan las cinco
  métricas o ninguna), con 10% predeterminado en producción y 100% en desarrollo,
  configurable con `VITE_WEB_VITALS_SAMPLE_RATE`.
- **Privacidad**: la mutación deriva `tenant_id` de la sesión en el servidor
  (las cargas anónimas de la página de inicio de sesión almacenan `NULL`) y
  descarta la muestra cuando el tenant no habilitó telemetría
  (`tenants.settings.telemetryOptIn`).
- **Registro**: cada muestra aceptada emite una línea pino estructurada bajo
  `module: web-vitals`.

### Mediciones de usabilidad de tareas

El flujo Web Vitals responde si una ruta se renderizó rápidamente; no puede
responder si el operador entendió qué hacer después. La mutación complementaria
`observability.reportTaskMeasurement` registra un intento agregado muestreado
para completar ventas, crear productos, recibir stock, cerrar el día y recuperar
pagos rechazados con acciones disponibles. Mide el primer control utilizable,
el primer avance y las interacciones necesarias para alcanzarlo, las
interacciones totales, retrocesos, errores de validación, intentos/resultado de
recuperación, resultado de tarea y duración total.

La tarea y la ruta pertenecen a listas fijas permitidas, todos los valores son
enteros acotados y el servidor deriva el tenant de la sesión autenticada. No hay
campo genérico de metadatos ni contenido de productos, clientes, pagos, ventas,
sedes, consultas, errores o notas. Los tenants que no habilitaron telemetría se
descartan antes de insertar. La tasa predeterminada de muestreo es 10% en
producción y 100% en desarrollo, configurable con
`VITE_TASK_MEASUREMENT_SAMPLE_RATE`. Los dashboards y la precarga por intención
de ruta siguen diferidos hasta tener datos representativos de tareas. La app
almacena estas muestras localmente y no las reenvía al destino centralizado de
telemetría. Operaciones comienza a medir recuperación solo después de que la
consulta de atención por tenant exponga un incidente real de pago reintentable;
la navegación de soporte por sí sola no es un resultado de recuperación.

### Objetivos por ruta

Estos son los criterios con los que el futuro dashboard de agregación medirá
los datos RUM; hoy son orientativos (sin verificación CI; primero deben
acumularse datos). Los valores siguen los umbrales «buenos» de Google Web Vitals,
con exigencias mayores para rutas que un cajero usa cientos de veces al día.

| Ruta                                       | LCP (bueno) | INP (bueno) | Notas                                                           |
| ------------------------------------------ | ----------: | ----------: | --------------------------------------------------------------- |
| `/login`                                   |    <= 2.0 s |   <= 200 ms | Primera impresión; aún sin ida y vuelta de autenticación.       |
| `/sales`                                   |    <= 2.5 s |   <= 200 ms | Vía frecuente: la respuesta del cobro importa especialmente.    |
| `/dashboard`                               |    <= 2.5 s |   <= 200 ms | Primera pantalla después de iniciar sesión.                     |
| `/products`, `/inventory`, rutas de listas |    <= 2.5 s |   <= 200 ms | DataTables grandes con filas virtualizadas.                     |
| CLS (todas las rutas)                      |      <= 0.1 |           — | Las dimensiones explícitas de imágenes reducen desplazamientos. |

Cuando se implemente el dashboard, calculará medianas por tenant y p95 por
`(route, metric)` y señalará rutas cuyo p95 supere el objetivo anterior.

## Cómo actualizar una línea base

Dos casos:

### 1. La regresión es intencional (una funcionalidad nueva requiere legítimamente bytes / ms)

En el mismo PR que introduce la regresión:

1. Edita `perf-budget.json` y aumenta la entrada afectada al nuevo valor medido
   (redondea hacia arriba al entero más cercano para tamaños de bundles y al
   múltiplo de 5 ms más cercano para latencia).
2. Menciona la métrica y la diferencia en el cuerpo del commit, por ejemplo,
   `colateral: bump SalesPage bundle budget from 33 to 38 kB gz to
absorb the new keyboard-shortcuts hook`.
3. El revisor aprueba: el aumento de presupuesto forma parte del diff revisado,
   no de una vía de escape oculta.

### 2. La regresión es accidental (ningún cambio de alcance debería haber alterado la métrica)

Detén el PR y encuentra la causa real. El umbral absorbió el ruido; si la
verificación falla pese al umbral, algo real cambió.

## Cómo agregar un procedimiento a la verificación de latencia

1. Abre `perf-budget.json` y agrega una entrada en `trpcLatencyMs.p95` con el
   límite p95 deseado (parte de una medición y redondea al múltiplo de 5 ms más cercano).
2. Abre `packages/server/src/__tests__/perf-trpc-latency.test.ts` y agrega una
   rama en `invokeProcedureForLatency()` que llame al procedimiento con entradas
   mínimas (paginación y valores de identidad predeterminados).
3. Ejecuta `pnpm run ci:server` para confirmar que pase la nueva verificación.

## Cómo agregar un chunk al presupuesto de tamaño de bundles

1. Abre `perf-budget.json` y agrega una entrada en `bundleSize.perChunkGzKb` con
   el tamaño gzip medido en KB (redondea hacia arriba al entero más cercano).
2. La lógica que elimina hashes de `scripts/check-bundle-size.mjs` usa
   expresiones regulares: el nombre del chunk (sin el sufijo `-<hash>.js`) debe
   coincidir exactamente con la clave del presupuesto.

Los chunks condicionales siguen el mismo contrato de rechazo seguro. Un chunk
que solo existe en algunas compilaciones no puede conservar una entrada de
presupuesto incondicional si otras compilaciones admitidas lo omiten: la ausencia
de un chunk presupuestado hace fallar la verificación. A la inversa, cualquier
chunk emitido de 5 kB gzip o más necesita una línea base deliberada correspondiente,
incluidas integraciones opcionales. No consideres que un chunk condicional sin
presupuesto sea una excepción que solo genera advertencias.

## Captura de líneas base desde cero

```
pnpm --filter @puntovivo/web run build
node scripts/check-bundle-size.mjs
```

El informe PASS al final del script enumera cada chunk controlado con presupuesto
frente a valor real. Copia los valores reales a `perf-budget.json`.

Para latencia, ejecuta el perfil dedicado sin otra verificación de rendimiento activa:

```
pnpm --filter @puntovivo/server run test:perf:trpc
```

Cuando falla la prueba, imprime el p95 medido en el mensaje de error. Usa esa cifra
como nueva línea base.

Para memoria de Electron:

```
pnpm --filter @puntovivo/server run build
pnpm --filter @puntovivo/web run build
pnpm --filter @puntovivo/desktop run build:main
pnpm run perf:electron-memory:gate --strict --require-measurement
```

La tabla PASS imprime los MB medidos del conjunto de trabajo principal/renderizador.
Usa esos valores solo después de una ejecución estable en la misma clase de destino.

Para métricas web de Lighthouse:

```
pnpm run seed:dev                      # demo-co tenant in local.db
pnpm run dev:server                    # 8090 (background)
pnpm run dev:web                       # 3000 (background)
pnpm run perf:lighthouse
```

El script imprime `check-lighthouse: host = {...}` seguido de
`check-lighthouse: measured = {"schemaVersion":2,"routes":{...}}` con medianas
LCP / TTI / CLS / puntuación, conteo de muestras y evidencia de distribución de
puntuación por ruta; copia las métricas medianas a
`perf-budget.json::lighthouse.perRoute` (redondea los tiempos un poco hacia arriba
para absorber variación entre ejecuciones). Conserva los diagnósticos de host y
por muestra al cambiar una línea base. El ejecutor aislado mide una vista previa
de producción; las instrucciones manuales anteriores con servidor de desarrollo
sirven para diagnóstico, pero no deben recalibrar CI.

Para reproducir localmente el flujo CI de pushes:

```
node scripts/run-lighthouse-gate.mjs --strict --require-measurement
```

El ejecutor es propietario de una base temporal y una compilación web por defecto,
por lo que la evidencia de CI no depende de `packages/server/data/local.db` del
operador, pestañas abiertas del navegador ni puertos 3000/8090.

## Invariantes de memoria y búsqueda en ejecución

### Envolvente de mapeo de lecturas SQLite

Las conexiones de aplicación respaldadas por archivo usan un límite mmap de
32 MiB junto a la caché de páginas SQLite existente de aproximadamente 64 MiB.
Las páginas de lectura mapeadas pueden coexistir con páginas modificadas en la
caché de escritura, tablas temporales en memoria y el worker de hash de auditoría
durante una reescritura grande de privacidad; permitir un mapeo de 256 MiB inflaba
ese conjunto de trabajo combinado. Es una política uniforme de ejecución, no
una configuración exclusiva del perfil ni un aumento de ningún presupuesto RSS.
Un límite mmap no limita la memoria total del proceso. Los perfiles de latencia
en archivo, recuperación cifrada y verificación nativa siguen siendo necesarios
al ajustarlo.

El paginador de auditoría reutiliza una sentencia preparada cuya propiedad débil
corresponde a la conexión y vuelve a vincular tenant, cursor y tamaño de página
en cada lectura. No retiene filas de negocio ni almacena un veredicto de
integridad, y la redacción permanece en la transacción que la autoriza.

### Lecturas acotadas de contenido FTS

Las búsquedas amplias de productos clasifican contra todo el índice coincidente
con filtros autoritativos de tenant y negocio de productos aplicados antes del
límite final. Luego, una preselección materializada valida la identidad textual
FTS y la pertenencia al tenant en la misma instantánea SQL. Esto evita leer todo
el contenido FTS de cada coincidencia amplia. Clasificación, pesos y desempates
por nombre/id sin distinción de mayúsculas no cambian.

Si alguna identidad preseleccionada es inválida o falta, la búsqueda vuelve a
ejecutar la consulta original completa con sus restricciones. Nunca se limita a
eliminar una fila corrupta de la preselección ni oculta coincidencias válidas
tras el corte. Solo una preselección totalmente validada puede usar la vía rápida;
no se almacenan en caché resultados de negocio ni veredictos de integridad. La
alternativa es un límite de corrección, no permiso para ignorar ni reparar
corrupción del índice silenciosamente.

### Sentencias preparadas de búsqueda de productos

El SQL de preselección FTS y de alternativa ante corrupción se reutiliza por
conexión nativa SQLite mediante una caché acotada de propiedad débil (32 formas
de filtro y como máximo 64 sentencias). Todos los valores de tenant, consulta,
filtro y límite se vuelven a vincular en cada llamada. Nunca se almacenan en
caché resultados, pertenencia a farmacia ni veredictos de integridad; los filtros
autoritativos permanecen antes del corte y la validación de identidad sigue en
la misma instantánea SQL. Las pruebas de conexiones independientes, mutaciones
en vivo y oráculo de consulta completa fijan esas garantías. Esta optimización
no cambia ningún presupuesto de rendimiento de búsqueda.

### Inicio de autenticación y mantenimiento de cuentas

La pantalla de recuperación y sus textos EN/ES permanecen en el cierre estático
de la aplicación para que un fallo de descarga de ruta no elimine los controles
de reintento/inicio de sesión. El mantenimiento de contraseña de cuenta carga
solo por acción explícita, con un diálogo de carga localizado que se puede
cerrar. El adaptador HTTP de Hub configurado carga solo ante una solicitud de
Hub; la custodia de credenciales y las barreras de generación permanecen en el
proceso principal de Electron. Los textos detallados de preparación de
configuración están separados del banner/lista de onboarding siempre disponible.
La prueba de regresión del manifiesto de producción verifica tanto la ausencia
del inicio como la alcanzabilidad dinámica real. Los presupuestos de chunks y
las tolerancias existentes no cambian.
