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

## Colombia: documento equivalente o factura electrónica

Toda venta en Colombia expide el documento equivalente electrónico tiquete POS
(DEE), sin importar el monto. La venta expide una factura electrónica de venta
(FEV) solo cuando el cajero marca que el comprador la pidió, y solo entonces el
cobro pide los datos del adquirente. No hay umbral automático de 5 UVT ni ajuste
de UVT.

Lo que dicen las normas, leídas en el normograma de la DIAN (actualizado el 28
de octubre de 2026):

| Regla                                                                                                                                   | Fuente                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| El DEE se puede expedir "independientemente del valor de la operación"                                                                  | [Res. DIAN 000227 del 23 sep 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm), art. 1.5.1.3.2.1, parágrafo (antes [Res. 000165 del 1 nov 2023](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm), art. 16)        |
| La doctrina DIAN lo lee igual                                                                                                           | [Concepto 1563 del 4 mar 2024](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_1563_2024.htm), pregunta 2; [Concepto 23570 del 27 dic 2024](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_23570_2024.htm)                                                |
| Quien expide documentos equivalentes siempre puede expedir FEV en su lugar                                                              | Res. 000227/2025, arts. 1.5.1.3.1.1 y 1.5.1.3.1.2, parágrafo; [Concepto 1874 del 12 feb 2025](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_1874_2025.htm)                                                                                                                |
| El comprador puede pedir FEV y entonces se debe expedir                                                                                 | [Estatuto Tributario](https://normograma.dian.gov.co/dian/compilacion/docs/estatuto_tributario.htm), art. 616-1, parágrafo 2 (Ley 2155 de 2021); [Decreto 1625 de 2016](https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1625_2016.htm), art. 1.6.1.4.26 (Decreto 442 de 2023)   |
| Los datos del adquirente se piden solo si pide el documento a su nombre: nombre o razón social, tipo y número de identificación, correo | Res. 000227/2025, art. 1.5.1.12.3 y su parágrafo 1 (antes Res. 165/2023 art. 69, adicionado por la [Res. 000202 del 31 mar 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0202_2025.htm)). El correo es opcional si se entrega la representación gráfica impresa |
| Un DEE sin identificar al adquirente ("consumidor final", 222222222222) no soporta costos ni impuestos descontables                     | Res. 000227/2025, art. 1.5.1.3.2.4, parágrafo 1                                                                                                                                                                                                                                              |
| El documento físico por fallas del vendedor no tiene regla de monto                                                                     | Res. 000227/2025, art. 1.5.1.5.7.1, numeral 2.2                                                                                                                                                                                                                                              |
| La UVT de 2026 es de $52.374                                                                                                            | [Res. DIAN 000238 del 15 dic 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0238_2025.htm), que sustituye el art. 1.2.1 de la Res. 227/2025                                                                                                                      |

De dónde sale la cifra de 5 UVT: el segundo inciso del parágrafo 2 del art.
616-1 del Estatuto Tributario todavía dice que el "tiquete de máquina
registradora con sistema POS" se puede expedir hasta 5 UVT, y la
[Res. 1092 del 1 jul 2022](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_1092_2022.htm)
fijó el calendario de 2023 para ese tope.

Nuestra interpretación: ese tope rige el tiquete POS tradicional, que no se
transmitía. La Res. 165/2023 lo sustituyó por el DEE con el calendario de 2024,
mantuvo las reglas del tiquete viejo solo hasta la fecha de cada contribuyente
(art. 68), y sus considerandos citan el límite de 5 UVT entre las restricciones
del tiquete tradicional que el DEE elimina. La doctrina DIAN coincide. La frase
de la ley no se derogó y el normograma no registra fallos contra el art.
1.5.1.3.2.1, así que esto se apoya en la reglamentación vigente y en la
doctrina DIAN. Hay que revisarlo si alguna de las dos cambia.

Comportamiento que se deriva:

- El cobro, en el panel de pago y en el POS táctil, muestra "El cliente pidió
  factura electrónica" cuando el pack de Colombia está activo y la sede tiene un
  rango de numeración FEV activo. Viene apagado y se limpia después de cada
  venta.
- Al activarlo, el cobro pide los cuatro datos de arriba y nada más. Los datos
  van solo a la instantánea fiscal; no crean ni editan un cliente, y el
  documento se vincula al cliente de la venta solo si lo nombra a él.
- La intención FEV se escribe en la misma transacción de la venta, igual que el
  DEE. Si la sede no puede numerar la FEV, la solicitud se rechaza antes de
  escribir la venta y el cajero puede cobrar con el DEE. Un rango que se agote
  después de esa revisión bloquea la intención a la vista de los operadores; la
  venta nunca se revierte.
- Las anulaciones y devoluciones referencian el documento original: nota
  crédito para una FEV, nota de ajuste para un DEE.

## Rangos de numeración de Colombia

La DIAN autoriza los consecutivos de la FEV y del documento equivalente POS
(DEE). Puntovivo guarda cada autorización como un rango en
`fiscal_numbering_resolutions`, uno por sede, tipo y ambiente DIAN. Los ajustes
del negocio ya no llevan campos de resolución.

| Regla                                                                                               | Fuente                             |
| --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| La FEV y el DEE requieren numeración autorizada; las notas crédito y débito se numeran internamente | Res. 000165/2023 arts. 42, 36 y 22 |
| Prefijo de hasta 4 letras o dígitos, obligatorio con más de un establecimiento                      | Res. 000165/2023 arts. 11 y 43     |
| Una autorización dura 2 años como máximo                                                            | Res. 000165/2023 art. 48           |
| Un rango agotado requiere una autorización nueva                                                    | Res. 000165/2023 art. 50           |

La Res. 165/2023 quedó compilada en la Res. 000227/2025; los números de
artículo equivalentes están por confirmar.

Comportamiento:

- `fiscalNumbering.*` lista, registra, activa, retira y elimina rangos. Los
  gerentes leen; los administradores escriben. Un rango nunca se edita: se
  retira y se registra de nuevo. Solo se puede eliminar antes de emitir un
  número.
- Un rango nuevo queda activo cuando la sede no tiene un rango activo de ese
  tipo, ya está vigente y su ambiente coincide con el del negocio; si no, queda
  en espera.
- Los rangos de un mismo prefijo, tipo y ambiente no pueden compartir
  consecutivos en ninguna sede. Un rango puede declarar el último número
  emitido con otro sistema, con un motivo.
- El rango se elige cuando se numera el documento, en la transacción que
  avanza el consecutivo. Cuando el rango activo se agota o vence, el rango en
  espera más antiguo que ya esté vigente toma su lugar en esa misma
  transacción, y el cambio queda en auditoría.
- Empresa → Fiscal lista los rangos por sede con consumo y vigencia, y los
  registra, activa, retira y elimina.
- Un rango genera un aviso 30 días antes de vencer o con menos del 20 % de sus
  números, y una alerta crítica 15 días hábiles antes del vencimiento, con
  menos del 5 %, o con menos de 3 días de números al promedio de 14 días. Las
  alertas aparecen en la tarjeta de rangos, en el panel (administradores y
  gerentes) y en el área fiscal de las alertas operativas, y no se muestran
  con la emisión DIAN apagada. Los días hábiles no descuentan festivos y los
  umbrales son fijos.
- El cobro le recuerda al cajero cuando la sede no tiene un rango usable,
  cuando solo tiene rango de factura, y que los documentos no se envían a la
  DIAN mientras el pack esté en modo de prueba.
- La clave técnica solo se exige para la FEV, nunca se devuelve completa y
  nunca se escribe en el log de auditoría.

Sigue abierto, a la espera de elegir proveedor tecnológico: el relleno con
ceros del consecutivo, cómo se entrega la clave técnica y si los rangos se leen
del proveedor en vez de digitarse. Con el pack de Colombia en modo de prueba,
un rango registrado solo numera documentos locales.

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
- `packages/server/src/services/fiscal/numbering/` y
  `packages/server/src/trpc/routers/fiscalNumbering.ts`: rangos de numeración
  de Colombia y el rango del que toma su número cada documento.
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

El veredicto público se mantiene en [PROJECT-STATUS.md](PROJECT-STATUS.md).
