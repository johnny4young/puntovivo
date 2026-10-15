# Puntovivo · Índice de documentación

**Idioma:** Español · [English](../README.md)

Este directorio contiene diseños, procedimientos operativos y referencias del
proyecto. Elige el archivo que responda tu pregunta. Los enlaces marcados como
«inglés» todavía no tienen traducción; la [cobertura bilingüe](../TRANSLATIONS.md)
identifica las versiones mantenidas.

---

## Arquitectura y tecnologías

| Archivo                                                                                                                   | Uso                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md` (inglés)](../ARCHITECTURE.md)                                                                          | Estructura general de Electron + Fastify + tRPC + SQLite.                                                                                                                                                                                     |
| [`architecture/` (inglés)](../architecture/README.md)                                                                     | **Registros de decisiones de arquitectura (ADR)**: decisiones duraderas sobre autoridad local, comandos, contratos de sincronización, bandejas, conflictos, seguridad, módulos, modos de ejecución, dinero, personal y búsqueda de productos. |
| [`TRPC_ARCHITECTURE.md` (inglés)](../TRPC_ARCHITECTURE.md) + [`TRPC_TESTING_GUIDE.md` (inglés)](../TRPC_TESTING_GUIDE.md) | Diseño de procedimientos tRPC, esquemas y pruebas sin HTTP.                                                                                                                                                                                   |
| [`DESKTOP_RUNTIME_GUIDE.md` (inglés)](../DESKTOP_RUNTIME_GUIDE.md)                                                        | Notas de Electron: sandbox, backend integrado y módulos nativos Node-API.                                                                                                                                                                     |
| `architecture.mmd` + `architecture.svg`                                                                                   | Diagrama Mermaid y versión renderizada del sistema.                                                                                                                                                                                           |

## Motor fiscal para Latinoamérica

| Archivo                                                      | Uso                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [`FISCAL-INTEGRATION.md` (inglés)](../FISCAL-INTEGRATION.md) | Madurez de adaptadores por país, invariantes y requisitos de producción. |

## Alcance por vertical

| Archivo                                                                                                      | Uso                                                                         |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [`MODULE-ACTIVATION.md` (inglés)](../MODULE-ACTIVATION.md)                                                   | Activación de módulos por negocio.                                          |
| [`HARDWARE-POS.md` (español)](./HARDWARE-POS.md)                                                             | ESC/POS, cajón, lector y periféricos.                                       |
| [Printer setup (English)](../PRINTER-SETUP.md) · [Configuración de impresoras (Español)](./PRINTER-SETUP.md) | USB/Sistema, ESC/POS de red, colas locales y aceptación física.             |
| [`WEBHOOKS.md` (inglés)](../WEBHOOKS.md)                                                                     | Esquemas de eventos salientes, firmas, reintentos, ejemplos y recuperación. |

## Experiencia de usuario y sistema de diseño

| Archivo                                                    | Uso                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [`COMPONENTS.md` (inglés)](../COMPONENTS.md)               | Catálogo de componentes compartidos.                            |
| [`STYLING.md` (inglés)](../STYLING.md)                     | Tokens del sistema de diseño y componentes básicos de Tailwind. |
| [`RECEIPT-TEMPLATES.md` (español)](./RECEIPT-TEMPLATES.md) | Editor y renderizado de plantillas de recibos.                  |

## Operaciones y procedimientos

| Archivo                                                                    | Uso                                                                                                                                    |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [`PROJECT-STATUS.md` (inglés)](../PROJECT-STATUS.md)                       | Inventario canónico de capacidades disponibles, brechas y preparación para releases.                                                   |
| [`DEV-SEED.md` (español)](./DEV-SEED.md)                                   | Usuarios y contraseñas de prueba; variables SEED_PRESET / SEED_RESET / SEED_COUNTRY. **Nunca inventes credenciales: lee esta guía.**   |
| [`LOGIN_GUIDE.md` (español)](./LOGIN_GUIDE.md)                             | Inicio de sesión durante la primera ejecución.                                                                                         |
| [`ENVIRONMENT_CONFIGURATION.md` (español)](./ENVIRONMENT_CONFIGURATION.md) | Referencia de variables de entorno.                                                                                                    |
| [`SECURITY.md` (español)](./SECURITY.md)                                   | Autenticación, endurecimiento, límites de solicitudes y catálogo de auditoría.                                                         |
| [`DEBUGGING.md` (español)](./DEBUGGING.md)                                 | Problemas habituales de desarrollo.                                                                                                    |
| [`TROUBLESHOOTING.md` (español)](./TROUBLESHOOTING.md)                     | Procedimientos de recuperación para el operador.                                                                                       |
| [`TESTING.md` (inglés)](../TESTING.md)                                     | Contrato de CI, E2E, comprobaciones en vivo y validación de candidatos a release.                                                      |
| [`PERF-BUDGETS.md` (inglés)](../PERF-BUDGETS.md)                           | Presupuestos de tamaño del bundle y latencia p95 tRPC de CI definidos en `perf-budget.json`.                                           |
| [`A11Y.md` (inglés)](../A11Y.md)                                           | Contrato de accesibilidad: auxiliar axe-core, contraste de tokens y convenciones ARIA.                                                 |
| [`OBSERVABILITY.md` (inglés)](../OBSERVABILITY.md)                         | Observabilidad de producción: sink compartido, captureException/withSpan, trazas tRPC por negocio, auditoría y errores de renderizado. |
| [`SHORTCUTS.md` (español)](./SHORTCUTS.md)                                 | Catálogo canónico de atajos y experiencia de la paleta global de comandos.                                                             |

---

## Contribución y comunidad

| Archivo                                                       | Uso                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------- |
| [`CONTRIBUTING.md` (español)](../../CONTRIBUTING.es.md)       | Preparación, convenciones y verificaciones para colaborar. |
| [`CODE_OF_CONDUCT.md` (español)](../../CODE_OF_CONDUCT.es.md) | Compromisos, estándares y contacto de la comunidad.        |

## Mantenimiento

Registra cada nueva referencia pública `docs/*.md` en la sección adecuada de
este índice en el mismo commit. Las guías públicas describen el comportamiento
actual y la arquitectura duradera. La planificación interna, estimaciones,
mapas de tareas y notas de traspaso pertenecen a un documento privado ignorado.

Consulta la [cobertura y las reglas de traducción](../TRANSLATIONS.md).
