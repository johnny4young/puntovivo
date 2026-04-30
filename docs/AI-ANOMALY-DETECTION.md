# Detección de anomalías y fraude en POS retail (ENG-032)

> Status: **Shipped** (ENG-032).
> Esta nota técnica vive con el código para que el "por qué" del
> feature siga siendo accesible para devs, operadores y revisores
> seis meses después de shippeado. Está en español neutral
> latinoamericano porque el contexto regulatorio y las cifras
> operativas son específicas de LATAM.

## Resumen ejecutivo

El detector escanea cada cinco minutos los últimos 30 días de
transacciones del tenant y marca cajeros cuyo comportamiento se
desvía estadísticamente del resto del equipo o de su propia línea
base. Surface en el dashboard de admin/manager como un tile con
contador y botón "Ver detalle"; el detalle abre un modal con la
tabla completa.

El módulo es **local-only** — usa solo SQLite embebido, no llama a
ningún proveedor de IA, no consume tokens y no envía datos del
tenant a ningún servicio externo.

Reusa el switch maestro `tenants.settings.ai.enabled` de ENG-030:
cuando el operador apaga la IA en `Empresa → Configuración de IA`,
el tile y el endpoint cortan limpio sin error.

## El problema operativo

En retail SMB —el target primario de Puntovivo—, el fraude interno
por cajero es estadísticamente la fuente número uno de pérdidas
operativas. Según el *ACFE Report to the Nations 2024* (sección
Latin America retail), las tiendas que no tienen detección activa
pierden **entre 1.5% y 3% de las ventas brutas mensuales** por
shrinkage interno.

Un ejemplo numérico que ayuda a poner la cifra en contexto: un
tenant que factura 50 000 USD al mes pierde típicamente entre 750
y 1 500 USD mensuales por fraude interno antes de detección
activa.

Sin detección, los operadores se enteran del problema solo cuando
la diferencia entre el cierre de caja y el inventario teórico es
visible —es decir, después de meses, cuando ya se acumuló suficiente
volumen para que el agujero sea evidente. Para entonces el cajero
puede haberse ido y la pérdida es prácticamente irrecuperable.

## Los cinco patrones de fraude más comunes

| # | Patrón                          | Cómo se ejecuta                                                                                                | Cómo lo detectamos                                                                                                              |
|---|---------------------------------|----------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| 1 | **Sweethearting**               | El cajero pasa un producto al amigo o cliente cómplice sin escanearlo. Cobra menos, regala el resto.           | `ticketsPerHourSpike` invertido (no implementado en v1; capturado como follow-up). El v1 detecta picos altos, no caídas anormales. |
| 2 | **Voids fantasma**              | El cajero anula una venta legítima ya cobrada y se queda con el efectivo.                                      | `voidRate`: proporción de anulaciones sobre ventas completadas, comparada contra los demás cajeros del tenant.                  |
| 3 | **Devoluciones fraudulentas individuales** | El cajero "devuelve" un producto que nunca volvió y embolsa el efectivo equivalente.                | `refundAmount`: monto de la devolución comparado contra la distribución de devoluciones del tenant (top-K con z-score > 3).      |
| 4 | **Aperturas sin venta (no-sale)** | El cajero abre la caja sin registrar venta y saca efectivo en silencio.                                       | `noSaleSessions`: sesiones de caja con cero ventas completadas y duración > 30 minutos, comparadas contra el equipo.            |
| 5 | **Actividad en horas raras**    | El cajero solo, en madrugadas o turnos vacíos, hace muchas transacciones rápidas que cubren voids o refunds.   | `ticketsPerHourSpike` personal: la hora individual del cajero comparada contra su propia media de 30 días.                       |

## Diseño técnico

### Por qué local-only y sin LLM

1. **Determinismo.** Misma data y misma fórmula producen siempre la
   misma alerta. Eso hace al detector auditable y defendible si un
   cajero impugna la decisión. Un LLM introduce varianza que el
   tenant no puede reproducir.
2. **Privacidad.** Los datos transaccionales nunca salen de la base
   SQLite embebida. Tres marcos legales en LATAM exigen consentimiento
   explícito antes de transferir datos transaccionales fuera del
   país:
   - **Habeas Data en Colombia** (Ley 1581 de 2012 + Decreto 1377 de
     2013).
   - **LFPDPPP en México** (Ley Federal de Protección de Datos
     Personales en Posesión de los Particulares, 2010).
   - **Ley 19.628 en Chile** (Protección de la Vida Privada, en
     transición a la nueva ley aprobada en 2024).
   El detector estadístico cumple por construcción: nada cruza la
   frontera del proceso del servidor.
3. **Costo.** La detección corre cada cinco minutos en el dashboard
   sin consumir tokens. No escribe en `ai_audit_log` (no hay llamada
   generativa que registrar) y no compite con el budget mensual de
   IA del tenant.
4. **Suficiencia matemática.** Para los cinco patrones de arriba la
   estadística clásica es state-of-the-art. Un LLM no aporta señal
   real —solo opacidad y costo.

### Algoritmo: z-score con leave-one-out

El ROADMAP menciona "isolation forest variant". Esta v1 ship con
**z-score más Mahalanobis diagonal**, computado con la técnica de
**leave-one-out** (excluir al candidato del baseline contra el que
se mide). Tres razones:

- **Simplicidad.** Aproximadamente 80 líneas de matemática, totalmente
  testeable con fixtures sintéticos. Isolation forest puro en
  JavaScript son ~150 líneas más decisiones de tuning (depth,
  sample-size, contamination).
- **Robustez en muestras pequeñas.** En tenants reales —5 a 15
  cajeros activos en un mes— vanilla z-score sufre porque el outlier
  inflama la desviación estándar de la población y se "esconde" su
  propia z-score. Leave-one-out resuelve eso comparando cada cajero
  contra los otros n-1, no contra el grupo entero. Ver
  `services/ai/anomalyDetection.ts::leaveOneOutZScore` para la
  implementación con sentinel para varianza cero.
- **Una sola variable de tuning.** El threshold (3.0σ por defecto)
  es la única perilla que el operador podría querer girar. En
  isolation forest tendría tres más, todas con interacciones no
  intuitivas.

### Threshold: 3σ (≈ 0.27% probabilidad bajo H0 gaussiana)

El threshold de entrada es 3.0σ. Bajo esa distancia el detector no
emite alerta. Entre 3.0σ y 4.5σ la severidad es **media**; igual o
mayor a 4.5σ es **alta** (≈ 7e-6 de falso positivo, prácticamente
imposible por azar).

El threshold está hardcodeado para v1. Tunable per-tenant via
`tenants.settings.ai.anomalyThreshold` queda como follow-up en
BACKLOG —la mayoría de los operadores prefieren la predictibilidad
de "3σ en todas mis tiendas" antes que la flexibilidad.

### Cuándo subir a isolation forest

Criterios documentados para promover el algoritmo en un nuevo
ticket:

- Tasa de falsos positivos > 30% reportada por un tenant piloto
  durante un mes de observación.
- Falso negativo confirmado por el operador (fraude real que el
  detector pasó por alto).
- Tenant solicita explícitamente el upgrade y está dispuesto a
  pagar el costo de tuning.

La interfaz pública `detectAnomalies()` no cambia; solo cambian las
tripas del módulo. Eso protege a los consumidores (router tRPC,
card del dashboard) de cualquier evolución del algoritmo.

### Datos que consume

Solo lectura, sin migraciones de schema:

- `sales` — completed y voided por cajero, agrupado por hora para el
  detector de picos.
- `audit_logs` con `action = 'sale.void'` — fuente primaria para
  conteo de anulaciones (más rica en metadata que los flags directos
  en `sales`).
- `sale_returns.refund_amount` — outliers de monto de devolución.
- `cash_sessions` — sesiones de caja con cero ventas completadas
  más allá del piso de 30 minutos para el detector de aperturas
  sin venta.

Ventana de análisis: 30 días rolling, configurable por llamada vía
los parámetros opcionales `from`/`to` en `ai.anomalies.list`.

## Casos de aplicación

### Cuándo es relevante

- Tenants con dos o más cajeros activos (la detección cross-cashier
  necesita una población de comparación).
- Tenants con al menos 30 días de historia operativa (la ventana
  mínima del análisis).
- Tenants sin sistema externo de Loss Prevention (LP) o que quieren
  una segunda opinión interna.

### Cuándo NO aplica (el detector se degrada con elegancia, no
falla)

- **Un solo cajero en todo el tenant.** Los detectores cross-cashier
  no corren porque no hay población de comparación. Solo el detector
  personal-baseline (`ticketsPerHourSpike`) corre, comparando al
  cajero contra su propia media histórica.
- **Tenants nuevos con menos de 30 días de historia.** La ventana
  mínima no se cumple y el detector retorna `[]`.
- **`ai.enabled = false`.** El card del dashboard muestra "Activa la
  IA en Configuración" con un link a `/company`; el endpoint retorna
  `enabled=false` + `[]` sin error y sin correr los detectores.
- **Tenants con menos de cinco cajeros (`MIN_SAMPLE_SIZE = 5`).** Los
  detectores cross-cashier saltan por bajo poder estadístico. El
  personal-baseline sigue corriendo.

## Operación

### Quién ve las alertas

- Roles **admin** y **manager** ven el card en el dashboard.
- Roles **viewer** y **cashier** no ven alertas: viewer sí puede ver
  el dashboard general, pero el card se oculta; cashier se redirige
  a `/sales`. Defense-in-depth a nivel API:
  `ai.anomalies.list` está protegido por `managerOrAdminProcedure`
  y rechaza con `FORBIDDEN`.

Esta partición refleja la práctica operativa: un cajero no debería
ver alertas sobre sus compañeros (privacidad operativa) ni sobre sí
mismo (incentivo perverso a "calibrar el comportamiento al borde
del threshold").

### Cómo investigar una alerta

En la versión v1 el flujo es read-only:

1. El manager ve el card con el contador "N alertas detectadas".
2. Click en "Ver detalle" → modal con tabla.
3. Cada fila muestra severidad, tipo de anomalía, cajero, valor
   observado, línea base de comparación y timestamp.
4. El manager cruza esa información manualmente con
   `Configuración → Auditoría` (filtro por usuario y fecha) o con
   los reportes de ventas para confirmar la sospecha.

En una v2 (capturado como follow-up `[ai][ux]` en `BACKLOG.md`), cada
fila tendrá un botón **"Investigar cajero"** que pre-filtra
`audit_logs` y `sales` por ese cajero en la ventana exacta de la
alerta, ahorrando los pasos manuales.

### Cómo se asigna la severidad

| Distancia (z-score absoluto)        | Severidad reportada                       |
|-------------------------------------|-------------------------------------------|
| < 3.0σ                              | Sin alerta (filtrado).                    |
| 3.0σ ≤ distancia < 4.5σ             | **Media**.                                |
| ≥ 4.5σ                              | **Alta**.                                 |

El sentinel `LOO_EXTREME_DISTANCE = 99` se usa cuando la población
"resto" tiene varianza cero y el candidato difiere; produce siempre
severidad alta.

## Política de privacidad operativa

- Los nombres de cajeros aparecen visibles solo para roles
  admin/manager. Es consistente con las superficies operativas donde
  estos roles ya ven ventas individuales por cajero.
- Las alertas no se exportan automáticamente fuera de la consola
  retail (no hay email, no hay webhook, no hay log externo).
- El detector **no acusa** al cajero —marca un outlier estadístico.
  El operador es responsable de investigar antes de tomar acción
  disciplinaria. La copia del modal lo dice explícitamente:
  *"Úsalo como punto de partida para una investigación, no como una
  acusación definitiva."*

## Tunables documentados

Constantes exportadas en
`packages/server/src/services/ai/anomalyDetection.ts::anomalyDetectionConstants`:

- `ANALYSIS_WINDOW_DAYS = 30` — ventana de análisis por defecto.
- `MAHALANOBIS_THRESHOLD = 3.0` — entrada de severidad media.
- `HIGH_SEVERITY_THRESHOLD = 4.5` — entrada de severidad alta.
- `MIN_SAMPLE_SIZE = 5` — mínimo de cajeros para detectores
  cross-cashier.
- `REFUND_TOP_K = 10` — tope de devoluciones outlier reportadas.
- `MIN_NOSALE_DURATION_MS = 1 800 000` (30 minutos) — duración mínima
  de una sesión vacía para contarla.
- `MIN_PERSONAL_HOURS = 5` — horas activas mínimas para el detector
  personal-baseline.

## Referencias

- `docs/ROADMAP.md` §3b ENG-032.
- `docs/PLAN-V2.md` §2 Phase 1 (AI Wave 1).
- `docs/AI-ANOMALY-DETECTION.md` (este documento).
- ACFE Report to the Nations 2024, capítulo Latin America retail.
- Iglewicz & Hoaglin (1993), *How to Detect and Handle Outliers* —
  referencia académica para leave-one-out z-score y modified z-score
  basado en MAD.

## Changelog

- **2026-04-30 (ENG-032)** — primera versión. Cuatro detectores
  (`ticketsPerHourSpike`, `voidRate`, `refundAmount`,
  `noSaleSessions`), z-score con leave-one-out, threshold 3σ, ventana
  30 días, tile en dashboard con drill-down modal, namespace i18n
  `aiAnomalies` en/es.
