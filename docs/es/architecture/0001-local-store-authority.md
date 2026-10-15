# 0001: autoridad local de tienda

**Idioma:** Español · [English](../../architecture/0001-local-store-authority.md)

> Estado: aceptada
> Fecha: 2 de mayo de 2026

## Decisión

**El binario de escritorio Electron de cada caja es la fuente canónica de datos
operativos en el modo predeterminado `device_local`: ventas, pagos, devoluciones,
sesiones y movimientos de caja, movimientos y saldos de inventario, documentos
fiscales y auditoría. Un futuro servidor central consume eventos del almacén
local; nunca escribe directamente esas tablas.**

ADR-0008 amplía la decisión para varias cajas mediante **nodo de autoridad**.
En `device_local` es la caja; en `site_hub`, Store Hub controla el archivo SQLite
de la sede y los clientes son terminales, no escritores autoritativos.

Fastify se ejecuta **dentro del proceso** principal Electron
(`apps/desktop/src/main/` importa `@puntovivo/server` directamente). Es la raíz
del modelo de autoridad. En ese nodo toda mutación tiene la garantía física de
una transacción SQLite local aunque no haya red externa. Un cliente Hub remoto
sigue necesitando conexión con su autoridad.

Tres formas de ejecución comparten la regla:

- **Escritorio:** despliegue habitual; main integra Fastify y el renderer le
  habla mediante tRPC sobre HTTP loopback.
- **Desarrollo web:** Vite sirve React y Fastify corre separado desde
  `packages/server`. Servidor bare/E2E usa `packages/server/data/local.db`;
  lanzadores integrados eligen `packages/server/data/shared.db` salvo sobrescritura explícita.
- **Servidor independiente:** funciona sin Electron para pruebas. SQLite en
  memoria o directorio temporal se trata como autoridad equivalente a una caja real.

Cada mutación también se limita por `ctx.tenantId`, derivado en el servidor
de la sesión validada, nunca de un ID suministrado por renderer. Lo aplica el
singleton `desktopSession` en `apps/desktop/src/main/session/desktopSession.ts`;
el núcleo del puente, independiente de Electron, resuelve identidad antes de operar en base o sync.

## Alternativas rechazadas

- **Nube autoritativa con base central remota:** rompe operación sin conexión,
  requisito de pilotos minoristas colombianos y criterios de `PROJECT-STATUS.md`.
- **Malla CRDT entre cajas:** excesiva para POS. Dinero, fiscalidad y caja
  requieren resolución humana, ADR-0004, no convergencia eventual.
- **SQLite compartido por red/NFS:** viola el límite de archivo de autoridad
  única y agrega disponibilidad/latencia del sistema de archivos remoto al cobro.
- **Migrar Electron/SQLite a nube completa:** invalida la ventaja de privacidad
  y latencia de un producto cuya autoridad es local.

## Impacto de implementación

- **Ya aplicado:** `desktopSession` y el núcleo autenticado de handlers exigen
  negocio en cada método db/sync IPC; renderer no aporta un ID no validado por
  main. Canales limitados de dispositivo/presentación previos al acceso no
  contienen datos operativos del negocio. `audit_logs` registra al cajero en mutaciones críticas.
- **Los contratos futuros asumen autoridad local:** ADR-0002 exige
  `clientCreatedAt` del reloj de caja, no del servidor. ADR-0003 trata bandejas
  como salidas del almacén autoritativo hacia proveedor DIAN, pagos o central.
  ADR-0004 conserva la fila local de alto riesgo hasta resolución explícita.
- **Esquema:** las tablas operativas (`sales`, `sale_payments`, `sale_returns`,
  `cash_sessions`, `cash_movements`, `inventory_movements`, `inventory_balances`,
  `fiscal_documents`, `fiscal_document_items`, `audit_logs`) llevan `tenant_id`
  y columnas conscientes del dispositivo, ADR-0002. La central futura las lee
  mediante el contrato ADR-0005, no mediante escritura directa.
- **Servidor central:** toda arquitectura de sync, incluida evaluación de
  réplicas libSQL, DEBE conservar escritura local primero. Puede alimentar una
  réplica de lectura en nube; la escritura operativa siempre llega antes a Electron local.

## Mapa de implementación

- Registro de dispositivos y sobre de comando: ID derivado de instalación local Electron, no asignado por servidor.
- Diario de operaciones y núcleo de bandejas: el diario local distribuye efectos a bandejas.
- Ciclo de ventas y agregado de caja: operan dentro de la transacción SQLite local, sin buscar autoridad externa.
- Bandeja fiscal y contingencia: leen documentos locales y envían al proveedor, nunca al revés.
- Contrato sync v1: eventos publicados por el almacén hacia una futura central.
- API pública de eventos y webhooks: leen el diario; la central publica eventos, no acceso SQL crudo.

Actualizado: 2 de mayo de 2026, conjunto inicial de ADR.
