# 0007: núcleo de activación de módulos

**Idioma:** Español · [English](../../architecture/0007-module-activation.md)

> Estado: aceptada
> Decisión inicial: 7 de mayo de 2026
> Manifiesto, store y límites de entrega revisados: 15 de octubre de 2026

## Decisión

La activación vive en JSON `tenants.settings`, clave `modules`, no en tabla
`tenant_modules`. `packages/server/src/services/modules/manifest.ts` controla
`MODULE_IDS`, `MODULES_MANIFEST`, valores iniciales, clasificación, visibilidad
por rol e i18n. `Record<ModuleId, ...>` exige mapeo exhaustivo.

El estado efectivo combina valores del manifiesto y sobrescrituras del negocio.
`RING1_RETAIL_PROFILE` escribe un perfil deliberado solo esencial para un negocio
minorista nuevo. Los existentes sin sobrescritura conservan el manifiesto.
Los cinco módulos originales están activos inicialmente allí; no significa
IA opcional activa para todo negocio nuevo. Superficies, Companion, mesas y
eventos públicos requieren elección. Consulta [catálogo completo](../MODULE-ACTIVATION.md).

Desactivar conserva filas históricas y controla comportamiento. Un procedimiento
inactivo devuelve `FORBIDDEN`, `MODULE_NOT_ACTIVATED` y `details.moduleId`,
distinto de denegación por rol. ID desconocido produce `MODULE_UNKNOWN`.
El estado del módulo nunca sustituye autoridad de negocio o rol.

## Límites de servidor y comando

`createModuleGuard(moduleId)` compone con `adminProcedureWithModule`,
`managerOrAdminProcedureWithModule`, `cashierManagerOrAdminProcedureWithModule`
y `tenantProcedureWithModule`. `adminProcedure` y `managerOrAdminProcedure`
siguen separados para procedimientos sin módulo.

El espacio actual ofrece `modules.list` a manager/admin,
`modules.getEffective` autenticado y comandos administrativos críticos
`modules.setActive` y `modules.applyPreset`. Usan sobre e identidad de equipo;
ajustes, auditoría, resultado canónico e idempotencia finalizan en dominio.
JSON atómico conserva ajustes hermanos fiscales/IA/idioma.

Desactivar `dine-in`, incluso por preset, rechaza servicios normalizados abiertos
o borradores ligados a mesa. Comprobar y actualizar comparten `BEGIN IMMEDIATE`;
no se abre servicio entre ambos. Crear, suspender, mover o dividir borrador en
mesa revalida `dine-in` bajo su propio escritor. Las rutas heredadas no lo evitan.

Presets aplican un parche del servidor, sin reemplazar ajustes arbitrarios.
Opciones fuera del parche sobreviven. Empresa invalida `modules.list` y
`modules.getEffective` después de éxito. Auditoría distingue `'module.toggle'`
y `'module.preset_applied'`, recurso `'tenant_module'`, sin exponer secretos.

## Estado y rutas del renderer

`apps/web/src/features/modules/ModulesContext.ts` controla ahora un store
Zustand, no el antiguo provider React. `ModulesSync` se monta una vez dentro
del contexto autenticado; `useModulesSync()` lleva `modules.getEffective` al
store. La consulta conserva cinco minutos y no recarga al enfocar ventana;
mutaciones administrativas invalidan explícitamente. Logout restablece el
store para que otro negocio no herede indicadores.

`useIsModuleActive(moduleId)` y `useModulesSnapshot()` conservan sus firmas.
El manifiesto completa una caché fría; un placeholder no concede permiso.
El servidor sigue verificando. `RequireModule` controla subárbol/alternativa.
`<ShellRoute>` usa `allowedModule?: ClientModuleId`; Sidebar,
`requiredModule?: ClientModuleId`. Ruta inactiva redirige a `/dashboard`.

`/company?tab=modules` contiene `CompanyModulesCard`. `TAB_KEYS`/`isTabKey`
conservan enlaces `?tab=` y usan `general` si falta. `resolveModulesState`
ignora IDs almacenados desconocidos; `isModuleId`, `visibleDescriptors` y
`buildModulesBlob` mantienen coherentes catálogo y JSON.

## Superficies

`packages/server/src/services/surfaces/manifest.ts` controla `SURFACE_IDS` y
`SURFACES_MANIFEST`. POS Desktop tiene `moduleId: null`; POS Touch, KDS,
Pantalla del cliente, Mesero móvil y Companion refieren módulos reales.
`assertSurfaceManifestIntegrity()` valida referencias no nulas. El manifiesto
servidor es canónico, sin catálogo paralelo divergente. `surfaces.list` combina
descriptores y estado efectivo para manager/admin.

`SurfaceShellRoute` compone roles, módulos y `<Suspense>` antes de cargar
superficies diferidas fuera de `MainLayout`. Pedidos por voz en `/touch/voice`
requiere `pos-touch` y `dine-in`; `/m`, `mobile-waiter` y `dine-in`.
Activar solo el viewport no autoriza comandos de servicio de mesas.

Pantalla del cliente es opcional en todo preset. Un administrador la activa y
un rol de ventas abre ventana nombrada de navegador o una Electron aislada
reutilizable con preload de privilegio mínimo. Su proyección versionada por
negocio/sede/caja se bloquea si está vieja, sin conexión, mal formada o sin
sesión. Navegar a `/customer-display` redirige a Ventas; no es controlador ni homologación de monitor físico.

## Eventos públicos

`events-api` controla proyección de eventos de negocio. `PUBLIC_EVENT_TYPES`
y esquemas Zod de `packages/server/src/services/events/manifest.ts` definen cinco
eventos (`sale.completed`, `sale.refunded`, `inventory.adjusted`,
`cash_session.closed`, `fiscal_document.accepted`) y cuatro transiciones
operativas mínimas. `PUBLIC_EVENTS_VERSION = 1` cambia por ruptura de contrato,
no por cada evento aditivo.

`services/events/projector.ts::projectOperationEvent(op)` mapea
`operation_events` exitosos: `sales.create`/`sales.completeDraft` a
`sale.completed`, `sales.returnSale` a `sale.refunded`, `inventory.adjustStock`
a `inventory.adjusted` y `cashSessions.close` a `cash_session.closed`.
`projectFiscalDocumentAccepted` produce `fiscal_document.accepted` desde worker.
`markOperationCompleted` proyecta/encola con mejor esfuerzo; fallar un webhook
no revierte el negocio autoritativo confirmado.

`isModuleActiveInSettings(blob, 'events-api')` comprueba elección del negocio.
`webhook_outbox`, HTTPS firmado, suscriptores, reintentos y recuperación de
fallos definitivos están implementados; no son trabajo futuro de v1.
`events.getContract` y `events.peekOutbox` siguen siendo lecturas acotadas de
manager/admin. Alertas operativas exigen destino explícito y conservan ciclo/
intentos mínimos propios. Consulta [Webhooks](../WEBHOOKS.md) y
[Observabilidad](../OBSERVABILITY.md) para entrega y privacidad.

## Invariantes acopladas y alternativas

- `ai.enabled` es independiente de `copilot`: ver la función no prueba proveedor
  configurado. `copilot=false` oculta; con `ai.enabled=false` y `copilot=true`
  puede pedir configuración en vez de conversar.
- Flags fiscales (`fiscal_dian_enabled`, `fiscal.mx.enabled`, `fiscal.cl.enabled`)
  siguen separados; no afirmes que todos migraron al núcleo.
- Textos/errores están en `en` y `es`; se exige paridad regional.
- Tabla `tenant_modules` o enum de base exigiría migración y joins para un ajuste
  de manifiesto ya representado por JSON.
- Flags de compilación exigen reconstruir al activar negocio. La elección en
  ejecución es el contrato implementado; no hace falta prometer latencia sin medir.
- Borrar al desactivar destruiría historia. Desactivación lógica no es borrado regulatorio.

## Verificación

Manifiesto/estado, módulos activos/inactivos, rol/negocio, presets atómicos,
exclusiones de trabajo de mesas y rutas requieren regresión. Cambios visibles
exigen comprobación en vivo activa/inactiva. Agregar superficies/eventos amplía
manifiesto y controles, sin otra autoridad. Activar no certifica proveedor fiscal,
pantalla ni monitoreo externo.
