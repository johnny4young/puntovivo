# Seguridad

**Idioma:** Español · [English](../SECURITY.md)

Puntovivo protege la operación minorista local mediante aislamiento entre
negocios, controles explícitos de rol y sede, sesiones cortas, renderer aislado,
almacenamiento cifrado, efectos externos limitados y administración auditable.

## Autenticación y autorización

- Las contraseñas usan Argon2 y nunca entran en logs ni metadatos de auditoría.
- El inicio de sesión limita intentos por identidad y origen con estado persistente.
- Los tokens de acceso duran poco; los de renovación rotan en familias y detectan reutilización.
- Restablecer o cambiar una contraseña invalida sesiones existentes. Un cambio
  confirmado estaciona el trabajo del servidor y elimina la custodia del
  renderer, escritorio y Hub sin enviar otro logout autenticado con el token
  revocado. La finalización queda ligada a la identidad iniciadora; una
  respuesta tardía no puede borrar un acceso posterior. Los fallos del
  almacenamiento del navegador no interrumpen la limpieza de bearer, identidad
  visible, caché, pantalla pública o IPC. La telemetría opcional de tareas queda
  ligada a la generación de autenticación iniciadora y se comprueba al enviar
  el lote: una muestra diferida de desmontaje no puede ejecutarse de forma
  anónima ni bajo el siguiente operador. El logout ordinario invalida ese
  trabajo antes de desmontar pantallas y conserva el bearer solo hasta que
  termine el comando de estacionamiento/cierre del servidor.
- Las solicitudes inseguras respaldadas por cookies requieren protección CSRF.
- Autenticación y telemetría del primer render comparten un bootstrap HTTP
  seguro antes de mutar. Una cookie persistente de renovación puede sobrevivir
  a la cookie CSRF de sesión: la telemetría temprana no debe competir para
  crearla o reemplazarla. Las métricas conservan su ruta original mientras
  esperan. Si falla el bootstrap, se descarta esa telemetría opcional sin
  saltar CSRF ni reintentar escrituras prohibidas arbitrariamente.
- Si falla la comprobación inicial de autoridad por límite, interrupción o red,
  se bloquea el espacio sin confiar en el usuario en caché. El reintento
  explícito respeta la espera del servidor y vuelve a verificar sesión; no hay
  un bucle automático. Los carritos ligados al propietario son evidencia de
  recuperación, no autenticación. Rechazar una credencial lleva al acceso.
  Elegir volver a iniciar sesión limpia la custodia de escritorio y Hub antes
  de navegar y conserva una intención sin PII que impide reanudar automáticamente
  hasta un acceso nuevo y `auth.me` correctos. No revoca a distancia la cookie
  httpOnly del navegador: evita que restaure al operador anterior tras recargar.
  El acceso conserva el bootstrap CSRF seguro. Si no se puede eliminar la
  custodia local, el cambio de cuenta permanece bloqueado.
- Las generaciones de identidad delimitan renovaciones pendientes del renderer,
  verificaciones de tokens del escritorio y actualizaciones selladas de Hub.
  Una respuesta antigua no instala ni elimina otra identidad posterior. La
  renovación se comparte dentro de una identidad; la rotación ordinaria de
  token no cambia esa generación. Cambiar de identidad cancela la renovación
  anterior del navegador. La recuperación no conserva bearer, cookie ni
  identidad en caché, ni muestra diagnósticos crudos de transporte/IPC.
- Volver a entrar no equivale a entregar el dispositivo a otro empleado. Si una
  caja sigue asignada a otro operador, rechaza la adopción y orienta a recuperar
  esa cuenta para cerrar/estacionar de forma confirmada o cambiar de empleado.
  No se ignoran conflictos como fallos opcionales de registro ni se evitan
  omitiendo el identificador del dispositivo.
- El middleware compartido define capacidades de admin, manager y cashier.
- El cambio por PIN tiene ámbito, límites y auditoría; no crea privilegios
  que la terminal iniciadora no tenga permitido asumir.
- Los clientes Electron Store Hub conservan renovación y credenciales CSRF en
  main, selladas por el llavero del sistema. El renderer aislado solo recibe
  tokens de acceso cortos. Las llamadas Hub cruzan un proxy `/api/*` de destino
  fijo que elimina cookies del renderer y cabeceras no permitidas; no se puede
  redirigir a otro origen. Tiempo real usa el relay limitado
  `/api/realtime/subscribe`: main agrega el Bearer vigente, analiza frames SSE
  acotados y transmite eventos tipados por IPC. Solo acepta identificadores de
  colección y un cursor numérico, nunca una URL arbitraria.

## Aislamiento de negocio y sede

El contexto tRPC autenticado incluye la identidad del negocio. Toda lectura o
escritura debe limitarse a él. Los procedimientos que aceptan una sede validan
que pertenezca al negocio antes de leer o modificar operaciones. Toda superficie
administrativa nueva requiere pruebas entre negocios y límites de roles.

## Límite de Electron

El renderer usa aislamiento de contexto, integración Node desactivada y sandbox
Chromium. La navegación y las ventanas nuevas están restringidas. Las capacidades
de escritorio cruzan wrappers preload limitados y handlers main validados. El
renderer no lee directamente clave de base, secreto de bóveda, archivos ni
transporte nativo. La excepción deliberada es la clave de cifrado de respaldos,
protegida por rol administrador: restaurar entre equipos la requiere y un
administrador autenticado puede revelarla mediante un handler dedicado. Cada
revelado escribe primero una fila inmutable de auditoría del negocio; si no
puede registrar esa evidencia, no entrega la clave.

Los métodos db/sync del puente, las escrituras de ajustes del equipo y del
identificador del dispositivo autorizan la sesión de escritorio verificada en
main antes de ejecutar el handler. Los valores de negocio del renderer no son
la autoridad. Lecturas limitadas previas al acceso permiten tema y registro de
dispositivo; las actualizaciones regionales se normalizan a idiomas soportados
y no persisten una fila de base. Perder la sesión main produce un sobre IPC
con código acotado que se presenta como recuperación localizada. El preload
rechaza localmente para no mostrar detalles de invoke, stacks ni códigos
internos al operador.

Las filas crudas de `sync_outbox` son diagnóstico solo para administradores,
incluidos `getAll`/`getById`/`getByField`, el alias de pendientes y respuestas de
inserción/actualización. También se aplica a payloads históricos y filas
`local_only`: estar replicado no concede permiso de lectura. Los operadores
autenticados conservan recuentos y estado del negocio; los flujos usan
proyecciones tRPC limitadas según el rol.

Main aplica Content Security Policy y cabeceras del renderer. Los builds de
producción no heredan opciones DevTools de desarrollo.

## Preparación de cocina

Las lecturas y mutaciones de cocina se limitan al negocio/sede y requieren el
módulo. Cajeros, gerentes y administradores operan el tablero; solo gerentes y
administradores configuran estaciones y rutas. Las mutaciones verifican la
generación visible bajo el mismo escritor que persiste auditoría, eventos
inmutables y notificaciones. Una instantánea inválida rechaza ese ticket sin
ocultar otras preparaciones válidas.

Los DTO omiten datos financieros, de clientes y farmacéuticos. Las notas y
etiquetas de comensales son texto plano, no HTML; no ingreses datos sensibles
innecesarios. Las acciones sin conexión u obsoletas están desactivadas. La
notificación se entrega al menos una vez y no confirma recepción de una pantalla
ni impresora externa.

## Almacenamiento, secretos y respaldos

- Las bases locales empaquetadas usan SQLCipher. El servidor independiente en
  producción también lo requiere y no abre ni crea una base en archivo sin clave válida explícita.
- El escritorio obtiene la clave mediante almacenamiento seguro de Electron;
  en servidor independiente, el operador proporciona `PUNTOVIVO_DB_KEY` desde
  su administrador de secretos. Los archivos independientes en texto plano
  solo corresponden a desarrollo/pruebas.
- El respaldo incluye dentro de un ZIP la base SQLCipher cifrada bajo la clave
  de instalación, junto con manifiesto e identificador de dispositivo en texto
  plano. Se comprueba la integridad del conjunto al restaurar y se
  replica el mismo objeto por HTTPS al destino S3 del operador.
- La envoltura por contraseña v2 conserva exactamente N, r, p, sal, normalización
  y resultado de 32 bytes, pero deriva mediante scrypt asíncrono en una cola
  acotada para no bloquear el renderer ni el ciclo de main. Crear y extraer en
  producción usa archivos temporales privados con streaming. Entradas duplicadas
  o desconocidas, traversal, symlinks, registros solapados, metadatos excesivos,
  truncamiento, discrepancias CRC/hash/MAC y funciones ZIP no admitidas se
  rechazan antes de reemplazar un destino. El escritor ZIP controla ambos
  streams y espera su cierre tras cancelar o fallar I/O antes de quitar la
  salida temporal; abortar el archivo no cierra por sí solo un origen leído
  parcialmente. La extracción sin compresión usa un buffer fijo y completa
  escrituras parciales antes de reutilizarlo; CRC, límites y publicación atómica
  se aplican tanto a entradas almacenadas como a las antiguas comprimidas.
- La restauración prepara los datos antes de reemplazarlos y reinicia el
  servidor integrado en un punto controlado.
- Las credenciales de bóveda solo se escriben desde la perspectiva del renderer
  y se guardan tras el límite de secretos del escritorio.
- Logs y exportaciones ocultan contraseñas, tokens, autorización, correos,
  datos de tarjeta, certificados y campos con apariencia de credencial.
- Puntovivo no guarda PAN ni CVV. Los adaptadores conservan referencias seguras
  del proveedor y estado operativo.

### Evidencia de farmacia

- Referencias de receta, profesional, documentos del comprador y notas se
  guardan en un sobre AES-256-GCM con finalidad específica. Lecturas ordinarias,
  auditoría y sincronización no exponen esos campos, ciphertext ni digest con
  clave. Las asociaciones cliente/producto siguen siendo metadatos sensibles,
  no anónimos: tRPC limita su proyección por rol y el outbox crudo de escritorio
  requiere administrador como se describió antes.
- Aprobar y dispensar autentica el sobre, vincula la referencia descifrada al
  HMAC negocio/producto, autentica la credencial profesional sellada contra su
  digest de país y tipo y vuelve a validar política y autoridad actuales. Si
  faltan claves o hay payload inválido o alterado, rechaza con errores públicos
  estables. Si una aprobación congelada deja de servir, el cobro no sustituye
  credenciales silenciosamente: un profesional vigente debe volver a aprobar
  la misma evidencia sellada conservando referencia y cantidad disponible.
- El renderer elimina PII de recetas tras confirmar o cambiar de sujeto,
  reproduce límites de longitud/fecha del servidor y desactiva autocompletado
  y corrección del navegador en referencias, credenciales, documentos y notas restringidas.
- La clave portable se envuelve dentro de SQLCipher para mantener autocontenida
  la restauración. Separa el acceso ordinario, pero no protege frente a quien
  ya posea la clave de la base. Una envoltura externa requiere un diseño de
  recuperación revisado por separado.
- Los agregados farmacéuticos y su PII son locales. Aplicarlos remotamente se
  bloquea hasta disponer de intercambio de claves y un codec regulado completo;
  una fila base de producto no prueba que otro equipo pueda dispensarlo.

### Evidencia privada de prenómina

- Perfiles, motivos, identificación, entidades de aportes, sufijos de cuenta,
  cálculos e instantáneas son solo para administradores. Las proyecciones de
  auditoría y Command Envelope conservan atribución y resultado de versiones
  sin copiar valores privados.
- Recalcular vincula empleados y evidencia exacta de perfil, contrato,
  asistencia, corrección, conciliación y política a un token de autoridad. Se
  recalcula dentro de la escritura; si cambió la evidencia, rechaza antes de
  insertar otra revisión.
- Las tablas de nómina no entran a la sincronización genérica. La aplicación
  remota sigue bloqueada hasta definir cifrado, retención, intercambio de claves
  y responsabilidad de conflictos de datos laborales privados.
- Cada cálculo congela fuentes y límites de política; no constituye aprobación
  legal, envío PILA, nómina electrónica DIAN ni validación de un proveedor de nómina.

## Red y efectos externos

- CORS de Fastify es explícito y usa orígenes LAN permitidos en Store Hub.
- Los destinos TCP de periféricos se validan para impedir salida arbitraria.
- Los efectos de red fiscales, de pagos, hardware y sincronización usan
  bandejas persistentes y no se ejecutan dentro de transacciones de negocio.
- Los reintentos son acotados e idempotentes y el fallo final permanece visible.
- Los clientes Store Hub empaquetados requieren HTTPS. HTTP plano solo se
  acepta para un hub de desarrollo loopback; nunca se degrada silenciosamente
  la protección de credenciales LAN.
- Companion concede al visor una instantánea mínima limitada por módulo y un
  flujo de invalidación sin payload. Su worker PWA cachea una lista generada
  de recursos versionados y nunca intercepta `/api/*`; los totales autenticados
  se limpian sin conexión y tras salir, en lugar de tratarlos como datos móviles persistentes.

## Bandeja firmada de pedidos externos

Los pedidos usan un sobre tRPC firmado y acotado. El servidor autentica el cuerpo
exacto antes de analizarlo y vuelve a validar versión de credenciales, sede,
negocio y ventana temporal bajo el bloqueo de escritura. Recibos persistentes
por evento y nonces cortos impiden reintentos conflictivos; una cancelación
anterior a la creación no puede resucitar un pedido. Administrar conectores
requiere admin; revisar pedidos requiere manager/admin del negocio y sede.

Las claves se sellan con cifrado autenticado ligado al negocio y conector.
APIs, resultados, auditoría y notificaciones excluyen esas credenciales. Los
datos del destinatario permanecen en instantáneas operativas restringidas, no
en notificaciones. La clave de envoltura independiente debe conservarse en el
administrador de secretos; perderla impide verificar firmas. Tener claves de
desarrollo no exime del cifrado de producción.

Recibir intención firmada no cobra, reserva existencias ni crea una venta.
Aceptar requiere confirmar una cotización fresca a precios locales y crea
atómicamente un borrador sin pagar mediante el escritor existente. Una
cancelación posterior bloquea cobro/despacho pero no devuelve dinero ni
existencias silenciosamente. El adaptador es un contrato sandbox; no valida un
agregador comercial ni sus pagos. Consulta
[el límite de la bandeja firmada (inglés)](../architecture/0023-signed-external-order-inbox.md).

## Auditoría

Las acciones sensibles registran actor, negocio, sede cuando corresponde,
recurso, operación, resultado y metadatos seguros previos/posteriores. Incluye
autenticación, emparejamiento, autorizaciones, prevención de pérdidas, excepciones
de caja/ventas, privacidad, retención, protección de respaldo y firma de cierre diario.

La administración sensible nueva debe agregar auditoría en la misma transacción
cuando sea práctico, sin contraseñas, tokens, PIN, claves de cifrado ni credenciales crudas.

En Electron empaquetado, la frescura de la cadena se ancla fuera de SQLite con
un sobre versionado por negocio sellado con `safeStorage`, que guarda contador
y cabeza. El siguiente contador se reserva antes de que una escritura auditada
avance la cabeza, se autentica en el HMAC y se confirma solo tras el commit.
Una lista ordenada conserva cada candidato anterior al cierre de transacción:
una escritura confirmada seguida de otra abortada no borra la cabeza intermedia
recuperable. Solo se aceptan estados de caída acotados previos/posteriores al
commit; falta, retroceso o divergencia del estado externo tras adoptar el
ancla rechaza la verificación. El avance usa escritura versionada y las filas
posteriores a la adopción no pueden quedar sin encadenar silenciosamente.
Un despliegue independiente sin `AuditAnchorStore` conserva el enlace HMAC,
pero no detecta retrocesos externos y no debe anunciar esa función.

La verificación es paginada, cede el bucle de eventos y lleva hashes grandes a
un worker corto. La ejecución compartida y el límite de inicios administrativos
acotan recursos, pero no cachean éxitos entre llamadas de forma que oculten
mutaciones externas de la base. Aplicar auditoría por sincronización remota
sigue bloqueado hasta diseñar una cadena consciente del dispositivo.

## Dependencias y controles de release

Los scripts de compilación pnpm están permitidos explícitamente. Cada gate CI
de workspace audita dependencias de producción. Antes de un release se requieren
validación multiplataforma, firma/notarización cuando corresponda, comprobación
del feed de actualizaciones y ensayos de respaldo/restauración.

### Cadena de actualización

El feed es un appcast alojado en una rama GitHub Pages. Su hash de integridad
está en el mismo feed y no puede avalarlo por sí solo. Quien escribe esa rama
controla lo que se ofrece a las instalaciones. Dos medidas limitan el daño:

- **Firma de plataforma y versión mínima sellada** determinan si puede
  instalarse automáticamente. macOS verifica identidad: Squirrel.Mac rechaza
  paquetes cuya firma no coincida con la aplicación actual, pero no comprueba
  por sí solo la versión. Puntovivo agrega un mínimo monotónico sellado con
  Electron `safeStorage` fuera del feed mutable. Mantiene `allowDowngrade=false`
  y rechaza candidatos inferiores, incluso con política `rollback`. Un artefacto
  descargado persistido se muestra tras reiniciar, pero no se instala hasta
  reconfirmar versión y SHA-512 en el proceso actual. La reversión de emergencia
  requiere instalador manual entregado por separado y aprobación del operador;
  Pages no puede autorizarla. Windows solo verifica con identidad Authenticode,
  para la cual Puntovivo aún no tiene certificado; AppImage de Linux no verifica
  firma. Sin verificación, descarga la actualización pero nunca la instala al
  salir: requiere acción explícita del operador. La decisión pertenece a
  `main/auto-updater/install-policy.ts` y rechaza configuraciones no seguras;
  volver a habilitar una plataforma requiere revisión de código, no una variable.
- **Escribir la rama del feed es una credencial de producción.** Protégela con
  revisión obligatoria y sin force push; activa segundo factor en cuentas que
  puedan publicar allí o crear releases. El empaquetado rechaza publicar macOS
  sin firma o su entrada del feed: si falta el secreto, falla el release en vez
  de distribuir algo que ninguna caja pueda instalar.

Impedir la instalación silenciosa es una mitigación, no la solución definitiva.
Las cadenas firmadas Windows y Linux siguen siendo requisito antes de un
despliegue desatendido.

Normalmente se corrige una dependencia señalada elevando un mínimo de versión
acotado en `overrides` de `pnpm-workspace.yaml`. Solo se admite una excepción
transitoria si no existe una versión compatible corregida y el código vulnerable
no es alcanzable desde el artefacto distribuido. Cada aceptación está en
[`config/audit-dispositions.json`](../../config/audit-dispositions.json), con
responsable, argumento de alcanzabilidad, condición de retirada y vencimiento.

La auditoría verifica el alcance de cada aceptación:

- Solo sirve para avisos que su clasificador del grafo de producción marcó
  independientemente como no alcanzables. Uno alcanzable o desconocido sigue fallando.
- El paquete registrado debe coincidir con el del aviso.
- Si el aviso salió del informe, la aceptación queda obsoleta y falla para no
  sobrevivir a la corrección del proveedor.
- Los plazos son acotados: 30 días para herramientas solo de compilación y 14
  cuando se espera un parche. Las entradas vencidas se rechazan con su fecha.

La parte automática inspecciona el grafo de manifiestos de producción de pnpm,
no el bundle web ni el asar empaquetado, porque se ejecuta antes de compilar.
El argumento del artefacto está en `reachabilityArgument`, se revisa mediante
su vencimiento y no constituye prueba automática. El archivo debería estar
vacío en estado estable.

Ejecuta las comprobaciones de [TESTING.md (inglés)](../TESTING.md). Los requisitos
pendientes de producción se concentran en [PROJECT-STATUS.md (inglés)](../PROJECT-STATUS.md).

## Reportar problemas de seguridad

No publiques detalles explotables en un issue. Hay dos canales privados:

- Informes privados de vulnerabilidades de GitHub: pestaña Security y opción
  Report a vulnerability, habilitada el 22 de agosto de 2026.
- Correo a asesordeprogramacion@gmail.com, el mismo contacto publicado en el sitio.

Incluye versión, plataforma, reproducción, impacto y evidencia para coordinar
contención y divulgación. Responde personalmente un mantenedor; no hay un equipo
de seguridad detrás de la dirección.
