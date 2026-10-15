# Activación de módulos

**Idioma:** Español · [English](../MODULE-ACTIVATION.md)

Puntovivo distribuye una sola base de código con paquetes opcionales de
capacidades que pueden activarse por negocio sin borrar historia ni bifurcar el producto.

## Fuente de verdad

- Manifiesto: `packages/server/src/services/modules/manifest.ts`.
- Sobrescrituras del negocio: `tenants.settings.modules`.
- Decisión: [`architecture/0007-module-activation.md`](../architecture/0007-module-activation.md).

No existe tabla `tenant_modules`. Los valores predeterminados vienen del
manifiesto, las sobrescrituras viven en ajustes del negocio y desactivar es una baja lógica.

## Aplicación de controles

Los procedimientos componen controles ordinarios de negocio y rol con:

- `createModuleGuard(moduleId)`
- `adminProcedureWithModule(moduleId)`
- `managerOrAdminProcedureWithModule(moduleId)`
- `tenantProcedureWithModule(moduleId)`

Un módulo inactivo devuelve `FORBIDDEN` con `MODULE_NOT_ACTIVATED`. El renderer
usa el mapa efectivo mediante el store de módulos, `useIsModuleActive` y
`RequireModule`; rutas y navegación deben aplicar el mismo control.

## Catálogo

| Módulo              | Clase    | Anillo | Predeterminado del manifiesto | Negocio minorista nuevo | Superficie                         |
| ------------------- | -------- | -----: | ----------------------------- | ----------------------- | ---------------------------------- |
| `operations-center` | esencial |      1 | activo                        | activo                  | Operaciones y diagnósticos         |
| `quotations`        | esencial |      1 | activo                        | activo                  | Cotizaciones                       |
| `copilot`           | opcional |      1 | activo                        | inactivo                | Asistente de IA                    |
| `anomaly-detection` | opcional |      1 | activo                        | inactivo                | Anomalías locales                  |
| `semantic-search`   | opcional |      1 | activo                        | inactivo                | Búsqueda semántica de productos    |
| `events-api`        | opcional |      1 | inactivo                      | inactivo                | Webhooks salientes firmados        |
| `pos-touch`         | opcional |      2 | inactivo                      | inactivo                | POS táctil                         |
| `kds`               | opcional |      2 | inactivo                      | inactivo                | Pantalla de cocina                 |
| `customer-display`  | opcional |      2 | inactivo                      | inactivo                | Segunda pantalla con datos mínimos |
| `mobile-waiter`     | opcional |      2 | inactivo                      | inactivo                | Mesero móvil                       |
| `delivery`          | opcional |      2 | inactivo                      | inactivo                | Entregas                           |

`RING1_RETAIL_PROFILE` es el perfil explícito de un negocio minorista nuevo.
Los negocios existentes sin sobrescritura siguen usando el valor del manifiesto
para conservar compatibilidad.

## Invariantes

- El estado del módulo no sustituye el ámbito `ctx.tenantId` ni los roles.
- `modules.setActive` es exclusivo de administradores y se audita.
- Desactivar conserva filas persistentes e informes históricos.
- Los textos nuevos se entregan en inglés y español latinoamericano neutro.
- Una ruta condicionada debe tener controles coherentes de navegación, ruta y servidor.
- Cambios en esa superficie requieren comprobación en vivo activa e inactiva.
- Pantalla del cliente siempre es opcional. Un administrador la activa;
  un rol de ventas abre una ventana nombrada de navegador o una ventana
  Electron aislada reutilizable. Esta proyección local no registra ni homologa una pantalla física.

## Verificación

Prueba que los usuarios autorizados puedan usar un módulo activo, que los
inactivos devuelvan `MODULE_NOT_ACTIVATED`, que no se crucen negocios, que los
cambios emitan auditoría y que permanezcan estables los perfiles predeterminados activos e inactivos.
