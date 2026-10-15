# Integración fiscal

**Idioma:** Español · [English](../FISCAL-INTEGRATION.md)

Puntovivo modela documentos fiscales como evidencia operativa inmutable y aísla
el comportamiento por país tras adaptadores tipados. La madurez se informa
explícitamente; un pack borrador o mock nunca debe parecer certificado.

## Packs actuales por país

| País     | Madurez  | Capacidad actual                                                                                                                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Colombia | Mock     | Ajustes del negocio, numeración, instantáneas inmutables, identificadores locales compatibles con CUFE, bandejas, informes y controles de preparación. Sin transmisión mediante proveedor certificado. |
| México   | Borrador | Validación RFC, ajustes/catálogos, XML borrador CFDI 4.0, mapeos y errores normalizados. Sin firma PAC, timbrado, cancelación ni consulta de estado de producción.                                     |
| Chile    | Borrador | Validación RUT, ajustes/catálogos, XML borrador DTE, asignación CAF, mapeos y errores normalizados. Sin firma de producción, transmisión SII, cancelación ni consulta de estado.                       |

El registro de adaptadores está en
`packages/server/src/services/fiscal/registry.ts`. Los documentos guardan también
la madurez del proveedor para etiquetar honestamente la historia aunque cambie
el país o la configuración del proveedor del negocio.

## Invariantes esenciales

- Venta, avance de numeración, instantánea fiscal inmutable y encolado se confirman atómicamente.
- País y ajustes fiscales del negocio eligen adaptador. Los países no admitidos
  omiten emisión en vez de recibir un documento con estructura colombiana.
- La red no se ejecuta dentro de la transacción de venta; transmite el worker de la bandeja.
- Comprador y líneas se congelan; los informes no reconstruyen documentos
  históricos desde clientes o productos modificables.
- Reintentos y entregas duplicadas conservan idempotencia.
- Los documentos mock y borrador no pueden presentarse como aceptados por una autoridad.
- Enlaces y QR de verificación de autoridad solo salen de packs certificados.
  Los identificadores mock/borrador siguen siendo evidencia diagnóstica local.
- Secretos, claves privadas, certificados crudos y credenciales del proveedor
  nunca entran en metadatos de auditoría ni respuestas visibles al renderer.

## Prueba en recibos y operación

Detalles de venta, informes fiscales, recibos de navegador y ESC/POS aplican el mismo límite:

- Los registros mock/borrador muestran modo del pack, resolución de numeración,
  identificador local y aviso explícito de no transmisión.
- No exponen enlace ni QR de DIAN, SAT o SII, aunque su estado local sea `sent` o `accepted`.
- Los certificados solo pueden exponer identificador y QR después de que el
  proveedor devuelva un identificador final en un estado verificable.

Esto permite diagnóstico local y reconstrucción sin presentar una vista previa
como aceptación de la autoridad tributaria. No cambia el requisito de producción siguiente.

## Áreas principales de implementación

- `packages/server/src/db/schema/fiscal.ts`: documentos, artículos, resoluciones,
  certificados, ajustes y bandejas.
- `packages/server/src/services/fiscal/`: adaptadores, packs, orquestación,
  identificadores, mapeos, serializadores XML, worker y errores.
- `packages/server/src/trpc/routers/fiscal-settings.ts`: ajustes administrativos
  y preparación limitados al negocio.
- `apps/web/src/features/fiscal/`: documentos y preparación.
- `apps/web/src/features/company/`: tarjetas de configuración por país.

## Requisito de producción

Ningún pack está certificado para producción actualmente. Colombia requiere toda esta evidencia:

1. Contrato y credenciales de proveedor tecnológico autorizado.
2. Ciclo de certificado y resolución de numeración por negocio y sede.
3. Emisión, estado, corrección y cancelación en sandbox y producción.
4. Emisión en contingencia con reintento, fallo definitivo y recuperación del operador.
5. Identificador y QR de autoridad en recibo y PDF.
6. XML firmado y acuses de autoridad conservados durante el plazo legal.
7. Pruebas de reinicio, timeout, rechazo, entrega duplicada y colas grandes.
8. Respaldo/restauración que incluya documentos, bandejas, identificadores y artefactos retenidos.

El veredicto público se mantiene en [PROJECT-STATUS.md](../PROJECT-STATUS.md).
