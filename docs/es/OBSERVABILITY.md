# Observabilidad de producción

**Idioma:** Español · [English](../OBSERVABILITY.md)

Puntovivo conserva logs estructurados locales del dispositivo y puede enviar
errores y spans con datos ocultos a un destino compatible con Sentry cuando
lo permiten las condiciones del despliegue y el consentimiento del negocio.

## Contrato actual

| Superficie                      | Implementación                                                    | Comportamiento                                                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logs estructurados del servidor | `packages/server/src/index.ts`, `trpc/middleware/tracing.ts`      | Registra procedimiento, duración, resultado, correlación y contexto de negocio y usuario.                                                                         |
| Helpers de errores y spans      | `packages/server/src/observability/capture.ts`                    | Siempre registra localmente; solo envía eventos atribuidos al negocio después de su consentimiento.                                                               |
| Ocultamiento de datos           | `packages/server/src/observability/redact.ts`                     | Oculta credenciales e identificadores personales antes del envío.                                                                                                 |
| Destino del servidor            | `packages/server/src/observability/sentry.ts`                     | Adaptador Sentry/GlitchTip diferido y condicionado por DSN; una configuración inválida no bloquea el inicio.                                                      |
| Errores del renderer            | `apps/web/src/lib/observability.ts`, `apps/web/src/lib/sentry.ts` | Captura React, `window.error` y rechazos no manejados; los eventos remotos siguen sin atribución a un negocio.                                                    |
| Usabilidad de tareas            | `apps/web/src/lib/taskMeasurement.ts`, `observability.*`          | Muestrea intentos agregados de tareas fijas tras el consentimiento del negocio; no acepta contenido operativo ni metadatos libres.                                |
| Fallos de Electron              | `apps/desktop/src/main/crash-telemetry.ts`                        | Registra, captura, completa un envío acotado y sale ante excepciones no capturadas.                                                                               |
| Consentimiento del negocio      | `companies.updateTelemetryOptIn`                                  | Ajuste transaccional solo para administradores, con evento de auditoría e invalidación inmediata de caché.                                                        |
| Responsabilidad de recuperación | `@puntovivo/shared/operational-readiness` y Centro de operaciones | Identifica primer responsable, objetivo de respuesta, umbral de acción, superficie de recuperación y ensayo ejecutable para seis servicios operativos.            |
| Entrega de alertas externas     | `services/operations/alerts.ts`, `alert-worker.ts`                | Persiste incidentes de sincronización, fiscales, dispositivos y pagos; envía transiciones mínimas firmadas solo a un receptor HTTPS aprovisionado explícitamente. |

## Responsabilidad del operador

La superficie predeterminada de Operaciones combina señales de sincronización,
fiscalidad, hardware y pagos del negocio con el estado de respaldos y
actualizaciones de escritorio a cargo del administrador. Cada tarjeta muestra
estado textual, primer responsable, objetivo de respuesta, umbral explícito,
ruta de recuperación y recuento fijo de ensayos. El color facilita la lectura,
pero nunca comunica el estado por sí solo.

Las cuatro señales del servidor se actualizan cada 15 segundos y las mutaciones
de recuperación correctas invalidan el agregado inmediatamente. Sincronización
abre **Empresa → Datos**, donde se procesan colas y resuelven conflictos;
fiscalidad, dispositivos y pagos abren sus paneles de reintento auditados en
Operaciones. Las sesiones de navegador nunca muestran enlaces de respaldo o
actualización como si pudieran ejecutar trabajo local del dispositivo: esos
controles requieren el puente de escritorio Electron.

El contrato compartido es independiente del proveedor y lo verifica
`scripts/check-operational-readiness.mjs`. Los procedimientos estables de primera
respuesta están en [`OPERATIONS-RUNBOOKS.md`](./OPERATIONS-RUNBOOKS.md). El tablero
local no pretende reemplazar un destino de telemetría de producción ni un sistema
de guardias; permite asignar la recuperación incluso sin telemetría remota.

### Alertas operativas externas

Operaciones persiste el ciclo de las mismas señales de sincronización,
fiscalidad, dispositivos y pagos del negocio que aparecen en la vista de estado
de la tienda. Gerentes y administradores pueden reconocer un incidente, pero
eso solo registra su revisión: la condición permanece visible hasta que su
origen desaparece. Una recurrencia posterior crea otra identidad de alerta.

Un administrador puede aprovisionar un receptor HTTPS firmado en
**Operaciones → Alertas externas**. El payload se limita a identidad de alerta,
área, gravedad, estado, recuento, ruta local de recuperación y fecha/hora. Cada
intento de red se conserva como metadatos inmutables acotados; se excluyen
credenciales, cuerpos de solicitudes, IP de destino, cuerpos de respuestas y
registros del negocio. La evidencia de intentos se conserva 90 días y el
historial de alertas resueltas, 365 días. Credenciales ausentes, un receptor
desactivado o rechazo permanente producen un fallo de entrega visible y nunca
ocultan el incidente local.

Es transporte de software independiente del proveedor hacia un receptor que
el comerciante posee o contrata. No incluye monitoreo atendido, equipo de
guardia, SLA ni tiempo de respuesta garantizado.

## Consentimiento y privacidad

Se aplican dos condiciones independientes:

1. Los eventos del servidor atribuidos al negocio requieren un DSN configurado
   y el ajuste `telemetryOptIn` del negocio.
2. Los diagnósticos del renderer y del proceso sin atribución a un negocio
   requieren un DSN configurado; configurarlo constituye el consentimiento del despliegue.

Los logs estructurados locales permanecen activos en ambos casos. Los atributos
remotos pasan por `redactErrorAttrs`, que oculta claves de contraseña, token,
autorización, cookie, correo y otras credenciales sin modificar la entrada.

### Medición agregada de tareas

La medición de usabilidad está autenticada, se limita al negocio, muestrea una
vez por intento y requiere el mismo ajuste `telemetryOptIn`. El servidor solo
acepta esta estructura agregada fija:

- Tarea permitida y ruta canónica.
- Versión de contrato de tarea y clase general del dispositivo.
- Duraciones enteras de total, primer control utilizable y primer progreso.
- Recuentos de interacciones, retrocesos, errores de validación e intentos de recuperación.
- Resultados de tarea y recuperación.

No hay nombres arbitrarios de eventos ni sobre de metadatos, y el esquema de
almacenamiento no tiene columnas de usuario, sede, producto, cliente, pago,
venta, consulta, error ni notas. Zod y las restricciones SQLite `CHECK` aplican
listas permitidas, asociación de rutas, límites, coherencia temporal y de
recuperación. Los primeros recorridos instrumentados son completar venta,
crear producto, recibir existencias, cerrar día y recuperar un pago rechazado
real. El cobro registra la recuperación de sesión de caja dentro del intento
de venta. Operaciones inicia un intento de recuperación separado solo cuando
un administrador puede ver un incidente de pago accionable; abrir un panel
informativo de soporte o diagnóstico nunca cuenta como progreso ni éxito.

Las muestras permanecen en la base local del negocio. No se envían al destino
centralizado de telemetría; `recentTaskMeasurements` solo existe como prueba
local del contrato para gerentes/administradores y futura agregación en el
dispositivo. Cualquier exportación de soporte o tablero centralizado posterior
requiere otra decisión de consentimiento y privacidad.

## Correlación

El renderer crea un `x-correlation-id` nuevo para cada solicitud tRPC. El
servidor solo acepta `[A-Za-z0-9_-]{8,64}`; de lo contrario usa el identificador
de solicitud de Fastify. Los identificadores de correlación son únicamente
metadatos de diagnóstico y nunca autorizan ni gobiernan reglas de negocio.

## Configuración

- Servidor y Electron: `PUNTOVIVO_SENTRY_DSN`.
- Muestreo opcional de spans del servidor: `PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE` en `0..1`.
- Build web: `VITE_PUNTOVIVO_SENTRY_DSN`.
- Muestreo opcional de intentos: `VITE_TASK_MEASUREMENT_SAMPLE_RATE` en `0..1`
  (10% predeterminado en producción y 100% en desarrollo).

El SDK web se carga de forma diferida y se omite en builds sin DSN. La CSP solo
agrega el origen del DSN configurado. Las integraciones predeterminadas del SDK
están desactivadas para evitar modificar la red y capturar dos veces errores del navegador.

## Brechas operativas

La certificación de producción todavía requiere validar la instancia
Sentry/GlitchTip aprovisionada y el receptor de alertas externas elegido,
incluidas verificación de firma del receptor y asignación real de responsables.
También faltan una vista de tasa de errores por negocio y una métrica de
sesiones sin fallos. El ciclo local de incidentes, reconocimiento, retención
acotada, evidencia de entrega, tablero de responsables y procedimientos de
recuperación están disponibles; observar un proceso de guardia externo sigue
siendo un requisito pendiente para release en
[`PROJECT-STATUS.md`](PROJECT-STATUS.md).

## Verificación específica

```sh
pnpm --filter @puntovivo/server run test -- \
  src/__tests__/observability-capture.test.ts \
  src/__tests__/trpc-tracing.test.ts \
  src/__tests__/companies-telemetry.test.ts

pnpm --filter @puntovivo/web run test -- --run \
  src/components/feedback/__tests__/AppErrorBoundary.test.tsx \
  src/features/company/__tests__/CompanyTelemetryCard.test.tsx
```

Los gates completos de servidor, web y escritorio siguen siendo la referencia.

El contrato compartido de responsables y evidencia se verifica con:

```sh
node --experimental-strip-types scripts/check-operational-readiness.mjs
```
