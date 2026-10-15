# Estado del proyecto Puntovivo

**Idioma:** Español · [English](../PROJECT-STATUS.md)

> Actualizado: 2026-09-22. Esta es la fuente pública de referencia sobre las
> capacidades entregadas y la preparación para publicar versiones. La priorización
> interna, las estimaciones y las notas de ejecución permanecen en un archivo
> privado de planificación ignorado por Git.

## Posicionamiento del producto

Puntovivo es un POS con prioridad local para el comercio minorista latinoamericano.
Su primer segmento de producción sigue siendo el de tiendas colombianas con una
a diez sedes. Restaurante, ferretería, carnicería y farmacia ya tienen puntos de
entrada explícitos mediante perfiles operativos sobre ese núcleo minorista, sin
que ello implique certificaciones legales o sectoriales independientes. La venta
en producción sigue sujeta a certificación fiscal y validación de hardware físico.

## Base de capacidades entregadas

El candidato validado actual incluye:

- ventas centradas en códigos de barras, carritos suspendidos, pagos combinados,
  devoluciones normalizadas totales o parciales por línea y cantidad, ventas de
  reemplazo vinculadas para cambios, emisión y uso de saldo a favor del cliente,
  acumulación y canje de puntos de fidelidad, anulaciones, reimpresión de recibos,
  ventas a crédito, controles de aprobación del gerente, promociones porcentuales
  cuya autoridad reside en el servidor con ciclo de vida explícito y evidencia
  congelada por línea, y entrega de recibos por WhatsApp controlada por una persona,
  que genera texto y un PNG local opcional sin envío en segundo plano;
- navegación orientada a las tareas del operador, búsqueda de comandos, configuración
  guiada del negocio y pantallas de preparación y recuperación con lenguaje claro
  para personal no técnico. La tarjeta de preparación sectorial deriva hechos
  acotados al negocio para el perfil operativo seleccionado y enlaza directamente
  a la configuración faltante; es orientativa y nunca afirma certificación legal,
  de hardware o de producción;
- una Pantalla del cliente opcional para los roles de ventas, habilitada por un
  administrador y abierta como ventana con nombre en el navegador o como una única
  ventana reutilizable de Electron con aislamiento de seguridad. Su contenido de
  venta visible y versionado admite solo nombre mostrado, unidad, cantidad,
  precios, descuento, total de línea y totales de venta. El sobre opaco se limita
  a un negocio, una sede y una sesión de caja abierta mediante una capacidad local
  de emparejamiento aleatoria. La pantalla arranca de forma independiente sin
  montar proveedores de autenticación, negocio ni tRPC; la detección de cajas
  consume solo proyecciones locales emparejadas y excluye identidad de empleados,
  saldos de caja, turnos, denominaciones y configuración de plantillas. Los estados
  obsoletos, malformados, sin conexión, de cambio de caja, de fallo de ventana y de
  cierre de sesión ocultan los datos anteriores o fallan con mensajes acotados.
  Su arranque también omite el envío de Web Vitals, por lo que el renderizador
  auxiliar no hace solicitudes a la API de la aplicación. Abrir la pantalla de
  Electron exige además una sesión actualmente registrada en el proceso principal;
  los renderizadores obsoletos o anteriores al inicio de sesión no pueden crear
  una ventana auxiliar. La pantalla de Electron usa un preload dedicado sin
  capacidades en lugar del puente principal del POS. Es un flujo local de segunda
  pantalla, no un controlador de pantallas físicas ni una certificación de hardware;
- plantillas declarativas de recibos activas, compartidas entre la vista previa,
  la impresión del sistema en navegador/Electron y la salida ESC/POS del servidor
  y del cliente del hub, con símbolos QR/Code 128 nativos, evidencia fiscal
  inmutable e instantáneas de presentación, identidad del negocio, diseño de
  plantilla, origen del logo e idioma tomadas al vender para las reimpresiones
  ordinarias; páginas de códigos de impresora configuradas y una alternativa
  heredada segura para ventas completadas sin plantilla configurada; selección
  autenticada de impresora del sistema en escritorio guardada por negocio en cada
  computadora, tickets de prueba explícitos y orientación para configurar ESC/POS
  solo por red. ESC/POS directo por USB/serie y la certificación de impresoras
  físicas siguen sin estar disponibles;
- responsabilidad por sesión de caja, cierre a ciegas, movimientos auditados,
  evidencia de cierre del día, señales de anomalías y firma inmutable del gerente;
- inventario por sede, unidades, lotes, FEFO, sugerencias por vencimiento que siguen
  siendo informativas hasta que un gerente las convierte en una promoción
  explícitamente vinculada al lote, productos serializados, consulta de garantías,
  matrices de variantes, compras, devoluciones a proveedores y transferencias
  exactas entre sedes. Las compras directas y recepciones de pedidos exigen la
  identidad concreta completa de los lotes en las líneas con seguimiento por lote;
  devoluciones y anulaciones descuentan solo la procedencia congelada de la
  recepción, mientras las transferencias conservan lote, vencimiento, estado
  efectivo, costo, capa de destino y discrepancia explícita. Los modos de stock,
  lotes y seriales permanecen congelados mientras una transferencia diferida
  mantiene la custodia física en tránsito. La ausencia de un saldo por sede
  significa cero en esa sede física; los totales del negocio nunca inicializan
  la fila de otra sede. Las devoluciones normalizadas de ventas y reversiones
  completas restauran el costo congelado del lote en la capa actual y conservan
  vencimiento o cuarentena, incluso cuando una recepción posterior cambió su costo
  ponderado. El detalle de compra y su editor de devoluciones distinguen la
  cantidad aún no devuelta de la físicamente disponible en la sede receptora,
  incluida la procedencia exacta de lotes y seriales. Los gerentes pueden realizar
  conteos físicos a ciegas por sede para stock ordinario, cantidades exactas por
  lote y seriales escaneados. La aprobación exige que no hayan cambiado el saldo,
  la instantánea de identidades ni la base de valoración aplicable. Los valores
  contables exactos en centavos enteros conservan el valor residual en
  transformaciones fraccionarias, devoluciones de ventas, reversiones de
  proveedores, transferencias y conteos; el costo del inventario y el costo
  comercial de ventas permanecen separados. Un valor histórico desconocido sigue
  siendo desconocido hasta una adopción explícita admitida, sin inventarlo durante
  la migración. Los resúmenes de stock y vencimiento usan los valores adoptados,
  incluido el cero conocido, y recurren al comportamiento heredado solo cuando
  falta evidencia. Cambiar el seguimiento exige conciliar stock, reservas y valor
  contable en todas las sedes. Las identidades desconocidas requieren recepción;
  los conteos conservan estados bloqueados de lotes y ponen en cuarentena los
  lotes agotados redescubiertos. Los seriales faltantes conservan su estado de
  stock, costo y garantía anteriores para su recuperación exacta. Las identidades
  de seriales esperadas permanecen ocultas hasta el envío. Los faltantes frente
  al stock mínimo generan sugerencias de reposición por sede; un operador elige
  proveedor y crea un borrador de orden de compra sin efecto sobre stock ni
  cuentas por pagar, y lo envía explícitamente antes de la recepción. Se admiten
  borradores con lotes y seriales porque el comando de recepción captura y
  revalida su identidad física; ningún pedido se realiza automáticamente. Los
  comandos de stock de compras, órdenes de inventario, transferencias y
  transformaciones vinculan atómicamente su auditoría, outbox de sincronización,
  resultado canónico de repetición y finalización de idempotencia; el historial
  de movimientos usa la sede activa por defecto, pero puede mostrar todas las
  sedes y las filas heredadas honestamente sin atribuir. Los artículos de servicio
  conservan sus datos al importar y exportar el catálogo, siguen siendo vendibles
  y se excluyen de las compras de inventario tanto en búsqueda como en escritura
  del servidor;
- perfiles seleccionables de ferretería y carnicería que solo ajustan las
  superficies de módulos y nunca reescriben el catálogo de un negocio. Las
  plantillas explícitas de creación de productos cubren ferretería por longitud,
  serial o lote y cortes de carnicería por peso o empacados, resolviendo unidades
  existentes. Los controles de productos, unidades alternativas, ventas, compras
  y pedidos conservan cantidades de hasta `0.001`. Los lectores que emulan teclado
  de la sede activa pueden asignar prefijos internos 20–29 a peso o precio; el
  servidor, y no el renderizador, controla esa interpretación. La ausencia de
  mapas conserva el diseño histórico y los mapas activos corruptos se cierran
  de forma segura hacia la búsqueda EAN ordinaria. Las etiquetas de peso exigen
  una unidad base de masa clasificada, convierten desde kilogramos a esa unidad,
  no pueden resolver silenciosamente un código de empaque y acumulan paquetes
  pesados sucesivos. Las etiquetas de precio de paquete completo conservan
  distintos precios codificados en líneas de venta distintas al suspender y
  reanudar. Un cajero debe consumir una autorización de gerente vinculada al
  cobro exacto antes de completar un precio fuera de catálogo; la comprobación
  previa vuelve a leer el catálogo actual del negocio o las instantáneas
  congeladas del borrador sin confiar en metadatos del renderizador. Los roles
  gerente/administrador conservan autoridad directa. La interpretación GS1
  incorporada se deshabilita cuando no hay sede activa;
- reservas por sede con controles de capacidad y solapamiento, llegada explícita
  y asignación de una reserva a una cuenta sin ventas vacías; creación versionada
  de entregas, despacho de repartidor y cancelación desde la UI sin cobro ni
  reembolso implícitos; intenciones firmadas de pedidos externos con evidencia
  duradera de repetición/cancelación, conectores sellados administrados por el
  administrador, aceptación explícita a precios locales en ventas suspendidas
  y reversión controlada por el operador. Estos grafos permanecen solo locales;
  el simulador genérico de remitentes no demuestra compatibilidad con agregadores
  reales;
- servicio de mesas de restaurante sobre el núcleo ordinario de ventas. Pedidos
  por voz y el POS tradicional pueden abrir atómicamente un borrador vinculado
  a una mesa junto con un servicio normalizado, cuenta independiente, comensales
  acotados, tiempo de servicio, ronda enviada, asignación de líneas e instantánea
  de modificadores estructurados. Mesero móvil y Pedidos por voz permiten editar
  hasta veinte modificadores distintos por línea, con cantidades y recargos por
  unidad, sin fusionar platos personalizados. Una visita a una mesa puede exponer
  todas las cuentas simultáneas; el número de comensales establecido y la capacidad
  de mesa se aplican en el servidor. Completar, descartar, mover una mesa de un
  servicio completo no compartido y dividir cuentas en la misma mesa mantienen
  alineados venta y servicio mediante escrituras serializadas; dividir o fusionar
  grupos implícitamente entre mesas se rechaza de forma segura. La liquidación
  exige cobertura exacta de cada línea congelada de venta, y la división concilia
  ajustes de cabecera, totales y filas de pagos provisionales sin dividir evidencia
  de fidelidad ni saldo a favor. Nivel de precio, stock, impuestos, recibos,
  devoluciones, sesión de caja y auditoría siguen las reglas minoristas compartidas.
  Los borradores heredados abiertos en mesas activas, incluidos los reanudados
  durante una actualización, se adoptan con cautela sin inventar comensales ni
  historial de cocina; los asociados a mesas archivadas siguen disponibles por
  recuperación heredada sin reactivar la mesa silenciosamente. No se puede
  deshabilitar el servicio en mesa mientras haya trabajo abierto, y reanudar
  compensa un fallo de hidratación local restaurando la suspensión original.
  Los cajeros de la misma sede pueden asumir y liquidar una cuenta normalizada,
  mientras los borradores minoristas genéricos siguen siendo privados; recibo y
  auditoría conservan identidades distintas de apertura y liquidación. Los
  catálogos de mesas buscan en el servidor antes de paginar de forma determinista,
  el plano lee el catálogo activo completo acotado y el trabajo suspendido pagina
  todo el conjunto recuperable sin ocultar filas excedentes. Los borradores
  nuevos y reanudados registran reclamaciones de actor y dispositivo; cada mutación
  del ciclo de vida exige el actor activo, el cierre de sesión estaciona todas
  sus reclamaciones y el cambio de personal estaciona solo la terminal actual
  antes de rotar la identidad. Una generación de identidad monótona por
  dispositivo y la versión de sesión JWT se vuelven a comprobar dentro de las
  transacciones críticas de venta, cerrando la carrera de cambio/cierre de sesión
  en curso. El registro ordinario no puede reclamar una terminal ya vinculada a
  otro actor activo; cerrar sesión y rotar la contraseña eliminan todas las
  vinculaciones del actor revocado y avanzan sus generaciones. Las rutas heredadas
  de ventas no pueden asignar, mover ni dividir trabajo hacia mesas cuando
  `dine-in` está deshabilitado. La pérdida de estado local puede recuperar la
  reclamación duradera del actor, mientras un cierre de sesión fallido conserva
  su copia de recuperación por propietario. Mesero móvil y Pedidos por voz
  requieren su módulo de superficie además de `dine-in`;
- preparación duradera de cocina con estaciones configurables por sede y
  enrutamiento por producto/categoría, líneas enviadas inmutables, preparación y
  recuperación versionadas, eventos de anulación, destinos actuales de división
  y mesa, y reenvío de notificaciones del mismo ticket. La transacción de venta
  persiste conjuntamente la preparación y su outbox de invalidación; reiniciar
  el worker reintenta notificaciones sin crear otro ticket de cocina. El tablero
  identifica la sede, actualiza la configuración de pares y deshabilita acciones
  obsoletas o sin conexión. Es estado local duradero, no entrega garantizada a
  hardware físico;
- recetas de inventario globales o por sede para ensamblaje, desensamblaje,
  cortes, porciones y productos preparados. Las ejecuciones congelan entradas
  y lotes reales exactos, nuevos lotes de salida, roles de producto principal,
  subproducto y remanente, desperdicio por entrada y lote, distribución
  determinista de costos, ambas bases de costo resultantes del producto, actor,
  movimientos, auditoría y evidencia de repetición en una transacción. La misma
  base de costo transformado alimenta la valoración de listas y conteos tras
  recargar. Los gerentes pueden inspeccionar esa instantánea y anularla solo
  mientras no hayan cambiado las revisiones de saldo de salida, ambos costos
  de producto con su revisión ni el lote;
- un perfil seleccionable de farmacia con extensión de medicamentos por negocio,
  búsqueda indexada por nombre comercial/genérico/ingrediente/fabricante/registro,
  política de país efectiva en el servidor, autorizaciones profesionales,
  evidencia mínima sellada de recetas, consumo determinista de cantidades,
  dispensaciones inmutables, eventos de estado de lote solo anexables, cuarentena,
  incidente de cadena de frío, retiro, liberación, destrucción, devolución al
  proveedor y consulta de ventas afectadas. Colombia v1 permite venta libre y
  exige cliente actual, evidencia y empleado autorizado vigente para productos
  con receta. Los medicamentos controlados y la operación con receta en países
  sin adaptador revisado se rechazan de forma segura. Una receta aún válida cuya
  aprobación profesional congelada vence o se revoca sigue bloqueada hasta que
  un empleado autorizado vuelva a aprobar explícitamente la misma evidencia
  sellada. Compras, transferencias, devoluciones, anulaciones y finalización de
  ventas conservan estados de lote no vendibles y custodia exacta; las
  transformaciones ordinarias rechazan medicamentos sin inventar un flujo de
  preparación regulada;
- clientes, proveedores, cotizaciones, administración de catálogos, importaciones
  iniciales con perfiles versionados para diseños de exportación de Loyverse,
  Alegra, Siigo y World Office probados localmente y alternativa genérica que
  falla de forma segura, exportación/anonimización por privacidad y controles
  de retención de datos. Una cotización aceptada puede entrar en un espacio de
  POS con condiciones bloqueadas y convertirse exactamente una vez mediante la
  transacción normal de venta; el vínculo inmutable cotización-venta, efectos
  de inventario, estado y auditoría se confirman juntos. Las cuentas de proveedores
  exponen facturas explícitas, saldos iniciales, antigüedad por vencimiento,
  pagos y créditos totalmente asignados y un estado de cuenta continuo a gerentes
  y administradores sin ampliar la administración del catálogo de proveedores.
  Las compras históricas nunca se convierten en deuda por un relleno inferido.
  Los nombres de importadores identifican fixtures de mapeo, no aceptación
  certificada por un importador externo;
- catálogos fiscales de demostración según el país y entre uno y cuatro
  componentes tributarios propios del negocio congelados en líneas de producto,
  venta, cotización y documento fiscal. Las columnas de resumen heredadas siguen
  siendo legibles, mientras recibos y el borrador UBL local sin firma de Colombia
  conservan IVA e INC incluso cuando ambos aplican a una línea. México y Chile
  rechazan combinaciones que sus serializadores de borrador no pueden representar
  sin descartar evidencia. Este modelo local no es certificación fiscal. Las ventas
  completadas con fiscalidad habilitada registran una intención inmutable de
  emisión en la misma transacción que stock, caja, auditoría, sincronización y
  resultado del comando. Un worker reiniciable materializa atómicamente documento,
  etiquetas de línea y componentes tributarios congelados, avance del consecutivo
  y outbox del proveedor; perder una señal posterior a la confirmación ya no
  pierde la obligación fiscal. No se asignan intenciones inventadas a ventas
  históricas. Las unidades estandarizadas y los tres niveles de precio cubren
  unidades base y alternativas en Ventas, POS Touch y cotizaciones. Seleccionar
  un cliente nunca cambia silenciosamente un ticket abierto: el operador aplica
  explícitamente su nivel y las ventas completadas congelan la cuadrícula de
  catálogo usada para juzgar cambios de precio posteriores. El puente contable
  por negocio exporta archivos de período acotados y auditables;
- cambio de empleado mediante PIN, condiciones laborales con vigencia,
  asignaciones de sede y cargo, ausencias aprobadas, disponibilidad recurrente,
  borradores de horarios recurrentes, publicación explícita e intercambios de
  turno ligados al consentimiento. Los motivos laborales y la compensación son
  solo para administradores; los gerentes ven una proyección acotada de
  asignaciones sin historial privado ni remuneración. El trabajo planificado se
  concilia explícitamente con evidencia de marcaciones que contempla correcciones
  o una inasistencia confirmada, congela la instantánea programada, registra
  tardanzas y descansos y expone el costo operativo regular limitado a la ventana
  del informe solo a administradores. Las clasificaciones de asistencia y
  exportaciones de evidencia contable siguen siendo insumos operativos. Los
  administradores disponen además de un espacio de prenómina orientado primero
  a Colombia con perfiles privados vigentes, períodos acotados, ejecuciones
  regulares y de ajuste solo anexables, revisiones inmutables de cálculo,
  instantáneas exactas de origen, revisión/aprobación explícita, rechazo de
  evidencia obsoleta y limitaciones de política congeladas por revisión. Es
  evidencia de revisión interna, no dinero definitivo de nómina, PILA, nómina
  electrónica DIAN, envío a proveedores ni certificación legal;
- almacenamiento cifrado en escritorio, SQLCipher que falla de forma segura
  para despliegues independientes similares a producción, paquetes de respaldo
  cifrados, instantáneas programadas, simulacros de restauración, ensayo y control
  de evidencia de recuperación empaquetada, carga a bóveda en la nube compatible
  con S3 y atestación de protección de respaldos;
- aislamiento de negocios y sedes, registros de auditoría, controles de rol,
  registro de dispositivos, modos locales de Nodo de autoridad, sesiones
  renovables de cliente Store Hub con custodia de credenciales en el proceso
  principal, transporte de API a destino fijo y tiempo real autenticado por
  Authorization con repetición, reconexión y comprobaciones activas de revocación;
  núcleo duradero de sincronización y pantallas de salud operativa;
- un Companion instalable con tamaño móvil para administradores, gerentes y
  lectores, respaldado por un modelo de lectura seguro para el negocio y
  protegido por módulo, con invalidación en vivo sin carga de datos. Expone
  resúmenes acotados de ventas/atención y metadatos de firma de cierre diario
  con integridad verificada, almacena en caché solo recursos versionados de la
  estructura de la aplicación y oculta datos operativos sin conexión en lugar
  de presentar una lectura almacenada como actual. Es una PWA de solo lectura,
  no una aplicación de ventas sin conexión;
- webhooks de salida opcionales por negocio para un contrato pequeño y
  versionado de eventos comerciales, con destinos HTTPS fijos, secretos de firma
  cifrados que se muestran una vez, firmas HMAC, claves estables de idempotencia,
  reintentos acotados y recuperación de cola de fallos definitivos, evidencia
  por destino, controles auditados y guía de integración con pruebas de contrato;
  no es una API REST pública general ni un catálogo certificado de conectores
  de terceros;
- ciclo de vida de alertas operativas por negocio para incidentes de
  sincronización, fiscalidad, dispositivos y pagos, con reconocimiento de
  gerente/administrador, receptor HTTPS firmado aprovisionado explícitamente,
  reintentos acotados y recuperación de fallos definitivos, evidencia inmutable
  de intentos y aplicación de retención; una entrega externa fallida o ausente
  nunca oculta el incidente dentro del producto, y esta vía de software no es
  un servicio de monitoreo atendido por personal;
- análisis de Copiloto por negocio sobre una instantánea acotada de solo lectura,
  con elección controlada por el administrador entre explicaciones guiadas y
  respuestas solo con resultados verificados; ambos exponen SQL, número de filas,
  tablas y gráficos deterministas disponibles, mientras el modo de solo resultados
  suprime la narrativa generada y explícitamente no afirma que SQL válido
  garantice una conclusión comercial correcta;
- un tablero de responsabilidad de recuperación independiente del proveedor para
  sincronización, fiscalidad, hardware de recibos, pagos, respaldo cifrado y
  actualizaciones de escritorio, con umbrales explícitos, roles responsables,
  objetivos de respuesta, procedimientos de recuperación y evidencia ejecutable
  de simulacros; los recuentos de incidentes por negocio se consultan e invalidan
  después de recuperar, y la web distingue claramente acciones del servidor de
  controles exclusivos de escritorio; los procedimientos guiados de pérdida de
  dispositivo y almacenamiento dañado llevan a los administradores a las
  pantallas reales de revocación y respaldo/restauración cifrados;
- fundamentos fiscales de Colombia y paquetes documentales en borrador para
  México y Chile. El simulador de Colombia puede conservar un borrador UBL 2.1
  local sin firma ni transmisión con el código de unidad UN/ECE congelado; es
  evidencia de desarrollo, no un documento firmado por un proveedor. Ningún
  paquete está certificado todavía para transmisión en producción;
- destinos Electron 43 y navegador que comparten el mismo núcleo React, Fastify,
  tRPC y SQLite.

## Veredicto de preparación

| Etapa                                | Veredicto                              | Evidencia y control pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demostración de desarrollo           | **Lista**                              | Once recorridos clave de turno en navegador tienen un índice ejecutable de evidencia EN/ES y adaptativa; diez también son recorridos de Electron independientes del destino. Se automatizan presupuestos de lectura a escala de tienda, importación, respaldo cifrado, colas, arranque del runtime compilado y memoria del renderizador durante turnos largos opcionales.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Beta interna controlada              | **Lista con controles de publicación** | [v1.14.4](https://github.com/johnny4young/puntovivo/releases/tag/v1.14.4) está publicada; según la comprobación del 2026-09-22, la [política de actualización activa](https://johnny4young.github.io/puntovivo/update-policy.json) y los feeds de plataforma la ofrecen al 10 por ciento. Su [flujo de publicación](https://github.com/johnny4young/puntovivo/actions/runs/35138577582) pasó, pero el empaquetado alojado no demuestra instalación en equipos representativos ni funcionamiento del actualizador. La [matriz de empaquetado/recuperación](https://github.com/johnny4young/puntovivo/actions/runs/31264233582) documentada de v1.10.1 es evidencia histórica de regresión, no evidencia del binario v1.14.4. Existen un contrato de Gate 5 que falla de forma segura y está ligado a hashes, y un ejecutor independiente de Electron; aquí no se enlaza ningún manifiesto aprobado de instalación limpia de v1.14.4, actualización mediante el actualizador de producción y rechazo real de una versión inferior. Completa Gate 5 en equipos representativos antes de promover el despliegue por encima del 10 por ciento. |
| Piloto minorista privado en Colombia | **No listo**                           | Requiere una vía con proveedor fiscal real, operación en contingencia, prueba de recibo fiscal firmado y validación de la impresora, cajón, lector y terminal de pago elegidos.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Venta en producción                  | **No lista**                           | Requiere certificación fiscal, evidencia de retención legal, política de soporte de hardware, receptor externo de alertas aprovisionado y observado, política de terminales de pago y un piloto observado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Brechas pendientes del producto

### Publicación y operaciones

- Mantén reproducible la evidencia de empaquetado entre plataformas, prueba básica
  de runtime, firma, notarización y actualizaciones escalonadas para cada candidato.
  Esa frase comprende dos controles distintos que no deben confundirse: el
  pipeline de publicación controla firma y notarización, y el flujo manual entre
  sistemas reproduce empaquetado, prueba básica y recuperación cifrada con
  artefactos sin firma. La matriz documentada de recuperación v1.10.1 es anterior
  al binario v1.14.4 actual. Una [ejecución manual posterior para cuatro destinos](https://github.com/johnny4young/puntovivo/actions/runs/34649168839)
  también pasó la recuperación empaquetada en septiembre, pero sobre un commit
  de rama y no sobre el candidato publicado v1.14.4. Ninguna ejecución conserva
  artefactos descargables. Instalar v1.14.4 de cero, actualizar mediante el
  actualizador de producción desde una versión firmada anterior compatible y
  rechazar versiones inferiores en equipos representativos siguen siendo
  controles ejecutados por el operador. El recolector de Gate 5 calcula hashes
  de instaladores firmados, capturas, exportaciones canario, el par de bases de
  datos sin cambios y el informe independiente de Electron; su validador falla
  de forma segura ante diferencias de candidato/equipo o falta de revisión
  independiente.
- Mantén reproducible para cada candidato el ensayo de recuperación cifrada
  empaquetada entre plataformas. Usa como base los resultados documentados de
  v1.10.1 con 262,865 filas y después establece expectativas operativas de tiempo
  y punto de recuperación a partir de un piloto representativo, sin tratar una
  medición de un ejecutor CI como objetivo universal de servicio.
- Valida los procedimientos entregados de fiscalidad, actualización, bóveda en
  la nube, dispositivo perdido y almacenamiento dañado frente a artefactos de
  versiones empaquetadas.
- Aprovisiona el canal entregado de alertas operativas por HTTPS firmado contra
  el receptor de producción seleccionado, verifica validación de firma y
  responsabilidad de alertas en el receptor y obsérvalo durante un piloto. La
  vía de entrega de software no es un servicio de monitoreo atendido ni una
  garantía de tiempo de respuesta.

### Fiscalidad y pagos

- Integra y certifica un proveedor tecnológico colombiano con credenciales de
  entorno de pruebas y producción.
- Completa emisión en contingencia, manejo de reintentos y fallos definitivos,
  retención de XML firmado, prueba de QR/identificador y recuperación visible
  para el operador.
- Valida el adaptador de terminal de pago y la política de riesgo sin conexión
  con un proveedor y una terminal física elegidos.
- Trata los paquetes de México y Chile solo como borradores hasta superar firma,
  transmisión, cancelación, certificación y conformidad específica de la autoridad.

### Hardware y topología de tienda

- Certifica impresoras ESC/POS, cajones RJ11 y lectores USB HID representativos,
  así como la vía de impresión por red compatible, en un laboratorio físico.
- Valida ubicación, escalado, conexión/desconexión en caliente, reconexión,
  operación de quiosco y privacidad de la Pantalla del cliente en segundos
  monitores físicos representativos. La automatización de ventanas de navegador
  y Electron no certifica ese hardware.
- Implementa o excluye explícitamente los transportes ESC/POS directos por USB
  y serie; hoy la vía segura de producción es impresión del sistema o TCP.
- Observa la operación del Nodo de autoridad con varias cajas en una tienda real
  antes de prometer escrituras de terminales satélite sin conexión o replicación
  remota entre varios nodos.

### IA e integraciones

- Concilia la estimación mensual local de IA con facturas y cuotas del proveedor
  en un piloto real. El control ya cubre lenguaje, OCR, voz, catálogo semántico,
  asociación de facturas y llamadas de embeddings por consulta; cada intento de
  embedding registra su contexto de negocio e informa explícitamente costo
  estimado, cero local, desconocido o no incurrido. Los límites del proveedor
  siguen siendo el tope autorizado porque Puntovivo no puede reservar ni
  certificar por adelantado una factura de terceros.
- Valida los archivos contables y de importación inicial generados cargándolos
  en cuentas reales de Siigo, Alegra y World Office antes de anunciar
  compatibilidad de conectores. Los fixtures actuales solo prueban análisis,
  mapeo, división, ensamblaje ZIP y recorridos de ida y vuelta locales; no prueban
  que un importador externo acepte los archivos.

### Integridad funcional del negocio

- Ya se entregaron emisión de saldo a favor, pagos con valor del cliente,
  instantáneas de promociones, restauración por devoluciones y vínculos de
  cambios. Los destinos de reembolso de pagos externos/con tarjeta aún requieren
  evidencia del operador; Puntovivo la registra, pero no afirma que un proveedor
  externo haya movido fondos. La conversión de promociones por vencimiento sigue
  deshabilitada en farmacia; no se infiere ningún descuento de medicamentos por
  cercanía del vencimiento.
- El Centro de operaciones enumera intenciones fiscales sin documento no
  resueltas, con acceso paginado y motivos seguros. Los gerentes pueden
  inspeccionarlas y los administradores volver a comprobar el contrato congelado
  mediante una acción auditada. Esa comprobación nunca sustituye una
  configuración modificada de proveedor o numeración. Una configuración inválida
  al vender aún requiere un flujo explícito de reemplazo/adopción que todavía
  no se admite. Esto no afirma recuperación fiscal desatendida ni certificación.
- El perfil de farmacia demuestra controles locales de software, no cumplimiento
  farmacéutico. Revisión legal por país, integración con INVIMA o registro
  equivalente, autorización de medicamentos controlados, recetas electrónicas,
  sensores de cadena de frío, hardware físico de farmacia y un piloto supervisado
  en tienda real siguen siendo controles externos. Los agregados regulados
  permanecen solo locales hasta que la sincronización pueda aplicar identidad
  de producto, política, evidencia, retiro y custodia de lotes atómicamente.
- La notificación duradera de cocina es al menos una vez y requiere consulta
  periódica/reconexión; un reconocimiento de difusión local no prueba entrega
  a una pantalla o impresora física. El editor de líneas del restaurante admite
  la lista acotada existente de modificadores. Los gerentes configuran adicionales
  versionados por sede desde la UI; los recargos de cajeros exigen una referencia
  exacta de catálogo activo comprobada dentro de la transacción de venta. Las
  instrucciones libres sin precio siguen disponibles, mientras cargos
  personalizados y adicionales restringidos requieren gerente/administrador.
  Editar y archivar el catálogo no altera pedidos aceptados. La programación
  de reservas no garantiza que el servicio previo de una mesa termine a tiempo.
  El adaptador firmado de pedidos externos es genérico y solo de pruebas, no
  compatibilidad certificada con proveedores; el mapeo y conciliación de
  agregadores reales siguen siendo requisitos externos. La pérdida destructiva
  de almacenamiento del cliente tras confirmar una reanudación se recupera
  explícitamente mediante la reclamación duradera del actor; la recuperación
  automática en segundo plano aún necesitaría una concesión/señal de actividad
  acotada por dispositivo. Estacionar globalmente al iniciar el servidor sigue
  siendo deliberadamente inseguro cuando otra terminal puede estar activa.
- Modela comisiones y desperdicio agregado al cierre diario cuando un piloto
  los requiera; el desperdicio de transformaciones se congela por ejecución,
  pero el cierre diario sigue informando comisiones y desperdicio generales
  como no disponibles en lugar de inventar ceros.
- Los perfiles de ferretería y carnicería siguen siendo puntos de entrada de
  catálogo/cobro: aplicar uno nunca crea una receta ni reescribe stock. El motor
  compartido de transformación ya admite consumo exacto de lotes de entrada,
  remanentes, recetas, rendimiento, desperdicio, costo distribuido, trazabilidad
  de lotes de salida y reversión protegida, pero no es planificación de
  fabricación, transformación de seriales ni certificación legal de producción.
  Los conteos físicos usan su propio flujo de identidad exacta. Los valores
  contables exactos en centavos enteros conservan residuos de asignaciones
  fraccionarias en las mutaciones de stock admitidas; el costo unitario mostrado
  de un lote sigue teniendo dos decimales y no debe usarse para reconstruir ese
  valor contable autorizado. Balanzas, lectores, diseños de etiquetas de medida
  variable y metrología legal aún requieren validación con dispositivos
  representativos; las etiquetas de país en configuración comparten actualmente
  el analizador genérico y no certifican una convención nacional. El precio de
  una balanza también debe calibrarse según el modo del negocio de precios con
  o sin impuestos; los fixtures de software no prueban que el total impreso de
  una etiqueta física tenga la misma semántica tributaria.
- Las cuentas de proveedores son un libro operativo local. La iniciación
  bancaria/por redes de pago, ingestión de extractos, conciliación de tres vías
  y registro en un libro mayor completo siguen fuera del límite actual y no
  deben inferirse de un pago registrado localmente.
- Las facturas, pagos y créditos de proveedores solo admiten anexos, pero la UI
  actual aún no ofrece un flujo dedicado de anulación/reversión ni asignación
  manual de remesas. Aplica pagos a los más antiguos primero; un origen
  registrado incorrectamente aún requiere corrección controlada del operador
  en lugar de un documento compensatorio inventado.
- Completa la revisión efectiva por país de festivos, convenios colectivos,
  retenciones, beneficios, deducciones legales y aportes; valida un adaptador
  real de proveedor de nómina, envío PILA/nómina electrónica, conciliación
  contable y un piloto supervisado de nómina antes de tratar revisiones internas
  de prenómina o costo laboral operativo como dinero definitivo de nómina.
- Completa una revisión de accesibilidad con NVDA en Windows y conserva la
  ergonomía del cajero en dispositivos reales en la lista de publicación.
- Conecta la evidencia entregada de alertas con el receptor de producción
  seleccionado y la rotación de responsables; los tableros de tasa de errores
  por negocio y sesiones sin fallos siguen siendo brechas separadas de
  observabilidad.

## Política de publicación

Una versión puede empaquetar funcionalidad completa y etiquetada con honestidad
sin implicar certificación del producto para producción. Publicarla no cambia
los veredictos de piloto o producción anteriores salvo que cada control
correspondiente tenga evidencia reciente.

Toda publicación pública es apropiada solo después de que su candidato supere:

1. controles CI de web, servidor y escritorio;
2. suites de extremo a extremo de navegador y Electron;
3. validación de actualización de base de datos y rechazo de versiones inferiores;
4. evidencia automatizada de respaldo cifrado y restauración aislada con otra
   clave, más una comprobación de recuperación de plataforma empaquetada;
5. validación manual de paquetes en Linux, macOS y Windows;
6. una nota seleccionada y orientada a personas en `docs/releases/vX.Y.Z.md` que
   explique el impacto para el operador y conserve las limitaciones fiscales,
   de hardware, recuperación y soporte anteriores; `CHANGELOG.md` sigue siendo
   el historial técnico de commits.

## Responsabilidad de la documentación

- Este archivo define estado del producto, alcance entregado y brechas con
  significado externo.
- `ARCHITECTURE.md` y los ADR definen invariantes del sistema y decisiones de diseño.
- `TESTING.md` define comandos de validación y límites de cobertura.
- Las guías de funciones describen solo comportamiento actual; no deben contener
  estado de planificación, identificadores de tickets ni colas de trabajo futuro.
- La estrategia detallada y la planificación de ejecución pertenecen a un archivo
  privado de planificación ignorado por Git.

### Propiedad en el primer uso

Las nuevas instalaciones interactivas de escritorio e independientes pueden
crear su primer negocio, ubicación y administrador desde la UI de inicio de
sesión. Las instalaciones históricas conservan su propiedad existente. La
reclamación de una sola vez no establece preparación fiscal, saldos, stock ni
autorización de productos regulados; siguen siendo asuntos explícitos de
configuración del gerente y validación externa. La reclamación independiente
es solo local y requiere un código privado de arranque; Electron conserva la
prueba en su proceso principal de confianza. Consulta la [Guía de inicio de sesión y acceso](LOGIN_GUIDE.md).
