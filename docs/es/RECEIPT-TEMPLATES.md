# Plantillas de recibos: editor visual e impresión en ejecución

**Idioma:** Español · [English](../RECEIPT-TEMPLATES.md)

> Estado: **Disponible**
> Contrato vigente revisado: 15 de octubre de 2026

Permite al administrador elegir y editar visualmente el diseño de recibos POS,
cotizaciones y representaciones impresas fiscales DEE/FEV, sin modificar código
ni CSS.

## Motivo

- Cada negocio tiene su propia marca: logo, colores y mensaje al pie.
- El papel depende del hardware: térmico de 58 u 80 mm o PDF tamaño carta.
- Hay secciones opcionales: pagos, IVA por línea, QR de verificación de autoridad
  cuando el pack fiscal esté certificado y propina sugerida para restaurantes.

## Principio de diseño: estructura declarativa sin HTML libre

La plantilla es **JSON estructurado** (`ReceiptLayout`), no un fragmento de HTML.
Cada elemento visible pertenece a un conjunto fijo de **bloques atómicos** con
opciones validadas. El renderer
(`packages/server/src/services/receipt-renderer/`) genera HTML para
`webContents.print` y bytes ESC/POS para el controlador térmico a partir del
mismo diseño.

Seguridad:

- El esquema es una unión discriminada Zod. Ningún campo de texto llega al
  HTML sin pasar primero por `escapeHtml`.
- Los valores de `{{namespace.path}}` se escapan al resolverlos; no se concatena
  entrada del usuario sin procesar con HTML.
- Solo se permiten los espacios `company.*`, `sale.*`, `item.*`, `fiscal.*` y
  `tender.*`; los demás no pasan la validación Zod.
- `qr.source` rechaza esquemas `javascript:`, `data:`, `vbscript:` y `file:`
  para impedir que un QR malicioso controle un cliente con lector.
- La vista previa se renderiza en un `<iframe srcDoc>` aislado. El CSS del
  recibo y el de la página no se afectan entre sí; los scripts de la vista
  previa no pueden ejecutarse.

## Bloques atómicos

Cada bloque ocupa una entrada en `ReceiptLayout.blocks`, con un máximo de 50.
El discriminador es `type`.

| Bloque         | Campos                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| `logo`         | `align?`, `maxHeightMm?`                                                                                          |
| `text`         | `value` (≤ 500 caracteres), `style?` (`title` / `subtitle` / `normal` / `muted` / `monospace`), `align?`, `bold?` |
| `itemsTable`   | `columns` (1–6 entre `name` / `qty` / `unitPrice` / `taxPercent` / `discount` / `total`), `showHeader?`           |
| `totalsBlock`  | `show` (1–5 entre `subtotal` / `discount` / `taxTotal` / `tip` / `grandTotal`)                                    |
| `tendersTable` | `showChange?`                                                                                                     |
| `qr`           | `source` (solo variables permitidas, sin esquemas JS), `sizeMm?` (10–60)                                          |
| `separator`    | `char?` (predeterminado `-`, máximo 4 caracteres)                                                                 |
| `barcode128`   | `source` (solo variables permitidas), `heightMm?` (8–40)                                                          |
| `appFooter`    | `show?`, `align?` (`left` / `center` / `right`)                                                                   |

Los bloques QR producen SVG inline real en HTML y una secuencia `GS ( k` real
en ESC/POS. Barcode-128 produce SVG monocromo real en HTML y comandos Code 128
función B nativos en ESC/POS. Ambos conservan una alternativa legible cuando el
origen está vacío, no se puede codificar o invadiría las zonas libres requeridas
por la impresora.

## Variables permitidas

Solo estos espacios se interpolan en `text.value`, `qr.source` o `barcode128.source`:

- `company.*`: `name`, `taxId`, `address`, `phone`, `email`, `city`.
- `sale.*`: `saleNumber`, `cashier`, `site`, `customer`, `customerTaxId`,
  `createdAt`, `subtotal`, `discount`, `taxTotal`, `tip`, `grandTotal`,
  `changeDue`, `notes`.
- `item.*`: solo tiene sentido dentro de `itemsTable`, por fila.
- `fiscal.*`: `cufe`, `qrUrl`, `resolution`, `documentNumber`.
- `tender.*`: solo tiene sentido dentro de `tendersTable`, por fila.

Las demás variables fallan al guardar. Un valor que se resuelve como `undefined`
se imprime vacío, de modo que un negocio parcialmente configurado, por ejemplo
sin `fiscal.cufe`, pueda generar el recibo correctamente.

## Dominio

### Esquema

`packages/server/src/db/schema/config.ts` declara:

```sql
CREATE TABLE receipt_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,            -- 'sale' | 'quotation' | 'fiscal_dee'
  name TEXT NOT NULL,
  paper_width TEXT NOT NULL DEFAULT '80mm',
  layout TEXT NOT NULL,          -- JSON, ReceiptLayout shape
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_receipt_templates_tenant ON receipt_templates (tenant_id);
CREATE INDEX idx_receipt_templates_tenant_kind ON receipt_templates (tenant_id, kind);
CREATE INDEX idx_receipt_templates_tenant_active ON receipt_templates (tenant_id, is_active);
-- Partial unique: at most one default per (tenant, kind)
CREATE UNIQUE INDEX idx_receipt_templates_tenant_kind_default
  ON receipt_templates (tenant_id, kind)
  WHERE is_default = 1;
```

El índice único parcial se declara mediante `uniqueIndex(...).where(...)` de
Drizzle y está en la migración consolidada `0000_baseline.sql`. El servicio
también protege la invariante en transacciones: antes de insertar o promover
una segunda predeterminada, desmarca la anterior en la misma transacción.

### Procedimientos tRPC solo para administradores

```
trpc.receiptTemplates.list({ kind?, includeInactive? })
trpc.receiptTemplates.getById({ id })
trpc.receiptTemplates.create({ kind, name, layout, isDefault?, isActive? })
trpc.receiptTemplates.update({ id, name?, layout?, isActive? })
trpc.receiptTemplates.delete({ id })
trpc.receiptTemplates.setDefault({ id })
trpc.receiptTemplates.duplicate({ id, name? })
trpc.receiptTemplates.renderPreview({ id?, layout?, kind? })
```

`renderPreview` acepta `layout` inline para la vista previa sin guardar o un
`id` para renderizar una fila existente. Devuelve `{ html, escposByteLength }`.
El renderer es el mismo que se usa al imprimir. Al entregar el resultado siguen
aplicándose el ancho del periférico y los ajustes del sistema operativo; la
coincidencia de la vista previa no homologa una impresora física.

### Servicio de renderizado

`packages/server/src/services/receipt-renderer/` exporta
`renderReceipt(layout: ReceiptLayout, data: RenderData): { html, escpos }`.
Es puro, determinista y no tiene I/O. Lo usan la vista previa y el contexto de
venta del servidor que alimenta la impresión del sistema en navegador/Electron,
las impresoras ESC/POS del servidor y los bytes ESC/POS para clientes Hub.

`buildPreviewData(kind)` genera datos sintéticos deterministas para mantener
estable la vista previa entre recargas.

## Interfaz

`/receipt-templates` es solo para administradores, registrada en `App.tsx` con
`adminOnlyRoles` y una entrada en la sección **Configuración** de la barra lateral.

La página mantiene dos modos locales:

1. **Lista:** tabla paginada por tipo. _Editar_ abre el editor; _Establecer como
   predeterminada_ cambia atómicamente la fila a `isDefault=true`; _Duplicar_
   crea una copia con sufijo « (copy)» sin heredar el estado predeterminado;
   _Eliminar_ pide confirmación y rechaza borrar la última plantilla de su tipo.
2. **Editor:** dos paneles.
   - **Izquierda:** lista de bloques, que se pueden subir, bajar o eliminar.
     Seleccionarlos abre campos específicos. Los botones superiores agregan bloques.
   - **Derecha:** **vista previa en vivo** dentro de un iframe aislado. Tras
     cambiar el diseño, espera 200 ms antes de llamar a `renderPreview`. El
     cliente aporta las etiquetas i18n de columnas, totales y pagos para que
     coincidan con el idioma de la sesión. En pantalla, el documento se contrae
     al ancho del panel para conservar visibles todas las columnas. El HTML
     térmico usa anchos útiles físicos: 48 mm para rollo de 58 mm y 72 mm para
     rollo de 80 mm, independientes de los puntos del cabezal. Al imprimir se
     elimina el relleno de vista previa y se adapta al área disponible sin
     reducir el tamaño de letra.

### Restricciones Zod y de interfaz

- Máximo 50 bloques por plantilla.
- Diseño plano, sin anidamiento de bloques.
- Máximo 500 caracteres por bloque de texto.
- Máximo 200 caracteres en el origen de QR o código de barras.
- Ancho de papel entre `{ '58mm', '80mm', 'letter', 'a4' }`.
- `itemsTable` requiere al menos una columna y `totalsBlock` al menos una línea.

## Enlaces de datos: de dónde salen los valores

Dos bloques pueden resultar poco evidentes porque el origen de datos es implícito:

### `itemsTable`

- Las filas son **siempre los artículos de la venta que se imprime**
  (`RenderData.sale.items[]`). No existe un selector de origen: el operador
  solo elige columnas —nombre, cantidad, precio, impuesto, descuento, total— y orden.
- En la vista previa, `buildPreviewData(kind)` de `receipt-renderer.ts` aporta
  una venta ficticia de cuatro artículos —Café 250g, Pan artesanal, Empanada de
  carne y Botellón de agua— con pagos divididos para ejercitar todas las columnas.
- En impresión real, el servidor construye `RenderData` con la venta y pagos
  contabilizados. Una venta completada congela cliente, sede, cajero, nombre/SKU
  del producto, nombre/datos fiscales/contacto de empresa e identificación del
  cliente para reimpresiones ordinarias. También congela diseño de plantilla,
  origen del logo y configuración regional BCP-47. Los marcadores de versión
  distinguen campos o ausencia de plantilla deliberados al cobrar; las filas
  anteriores a las migraciones recurren a registros y presentación actuales.
  Los recibos fiscales sustituyen además comprador, líneas, totales, moneda,
  configuración regional y fecha de emisión por instantáneas fiscales inmutables.
- El editor explica este vínculo encima de los controles del bloque.
- Los medios de pago usan etiquetas para el cliente (`Cash` / `Efectivo`,
  `Card` / `Tarjeta` y equivalentes) elegidas según el idioma del recibo. Los
  códigos de proveedores futuros desconocidos permanecen visibles literalmente.

### `totalsBlock`

- Renderiza una línea etiquetada por cada entrada de `show`: cualquier subconjunto
  de `subtotal`, `discount`, `taxTotal`, `tip` y `grandTotal`. Cada etiqueta sale
  de `editor.totalsLines.*` y cada valor del campo correspondiente en la venta:

  | Línea        | Campo de origen   |
  | ------------ | ----------------- |
  | `subtotal`   | `sale.subtotal`   |
  | `discount`   | `sale.discount`   |
  | `taxTotal`   | `sale.taxTotal`   |
  | `tip`        | `sale.tip`        |
  | `grandTotal` | `sale.grandTotal` |

  La aplicación calcula estos valores y el contexto de venta los lee. El
  renderer los formatea; nunca recalcula impuestos, descuentos, propinas ni
  totales, incluidos los totales congelados de documentos fiscales cuando
  corresponda. El cálculo de cabecera pertenece a
  [pricing.ts](../../packages/server/src/application/sales/pricing.ts), no al diseño visual.

- Junto a los controles, el editor ofrece una explicación desplegable de estos orígenes.

## Diseños predeterminados

`apps/web/src/features/receipt-templates/defaultLayouts.ts` incluye diseños por
clase para que el editor no comience vacío:

- `sale`: térmico de 80 mm con logo, encabezado de empresa, artículos, totales,
  pagos y agradecimiento.
- `quotation`: carta con columna de descuento y totales detallados.
- `fiscal_dee`: térmico de 80 mm con QR e identificadores fiscales. Los datos de
  verificación de autoridad permanecen vacíos mientras el pack no esté certificado.

Al abrir **Nueva plantilla**, el editor carga el diseño de `kind` y lo localiza
al idioma activo en ese momento. Cambiar `kind` después de editar conserva el
diseño en curso; puede ser deliberado partir de un diseño y reclasificarlo.

## Pruebas

Servidor: `packages/server/src/__tests__/receipt-templates.test.ts`.

- Zod rechaza espacios de variables desconocidos, esquemas JS en QR, más de
  50 bloques, texto de más de 500 caracteres y tablas sin columnas.
- El renderer escapa HTML en datos y texto literal: `<script>` queda como `&lt;script&gt;`.
- Maneja tablas vacías y variables desconocidas como texto vacío, sin imprimir
  `undefined`; genera líneas ESC/POS más estrechas para 58 mm que para 80 mm.
- CRUD tRPC: la primera plantilla de cada clase se vuelve predeterminada;
  setDefault cambia atómicamente; duplicar crea una hermana « (copy)» sin esa
  marca; borrar rechaza la última y promueve otra cuando se borra la predeterminada.
- Aislamiento: las plantillas ajenas no aparecen en list/getById.
- Permisos: manager y cashier reciben `FORBIDDEN`.
- Las ventas completadas conservan identidad y valores visibles tras editar
  clientes, productos, sedes, cajeros o empresa. Las ordinarias también conservan
  diseño, logo e idioma frente a cambios de plantilla, predeterminada, logo o
  configuración regional. Una venta completada sin plantilla activa conserva la
  salida heredada. Las filas anteriores a las migraciones mantienen su fallback
  a registros y presentación actuales.

Web: paridad i18n, lint y compilación.

## Archivos

```
packages/server/src/db/schema/config.ts                          # receiptTemplates table + indexes
packages/server/src/db/migrations/0000_baseline.sql              # current baseline migration
packages/server/src/db/migrations/0028_sale_display_snapshots.sql # ordinary receipt labels
packages/server/src/db/migrations/0029_receipt_identity_snapshots.sql # receipt identity
packages/server/src/db/migrations/0030_receipt_presentation_snapshots.sql # layout, logo source, locale
packages/server/src/db/migrations/0095_mighty_raza.sql            # cash handover snapshots
packages/server/src/application/sales/receipt-snapshots.ts       # tenant-scoped snapshot capture
packages/server/src/lib/errorCodes.ts                            # RECEIPT_TEMPLATE_* codes
packages/server/src/services/receipt-templates/                  # CRUD + default-flip transactions
packages/server/src/services/receipt-renderer/                   # preview + runtime renderers
packages/server/src/services/receipt-renderer/sale-context.ts    # runtime sale-to-template read model
packages/server/src/trpc/schemas/receiptTemplates.ts             # Zod ReceiptLayout
packages/server/src/trpc/routers/receiptTemplates.ts             # admin tRPC procedures
packages/server/src/trpc/routers/peripherals/                    # HTML/ESC-POS runtime delivery
packages/server/src/trpc/router.ts                               # registration
packages/server/src/__tests__/receipt-templates.test.ts          # tests
apps/web/src/features/receipt-templates/
  defaultLayouts.ts
  ReceiptTemplatesPage.tsx
  ReceiptTemplateEditor.tsx
  ReceiptTemplatePreview.tsx
apps/web/src/App.tsx                                             # /receipt-templates lazy route
apps/web/src/components/layout/Sidebar.tsx                       # Setup section entry
apps/web/src/i18n/index.ts                                       # receiptTemplates namespace
apps/web/src/i18n/locales/{en,es}/receiptTemplates.json
apps/web/src/i18n/locales/{en,es}/nav.json                       # items.receiptTemplates
apps/web/src/i18n/locales/{en,es}/errors.json                    # RECEIPT_TEMPLATE_* messages
apps/web/src/lib/translateServerError.ts                         # KNOWN_SERVER_ERROR_CODES
```

## Integración actual de impresión

- El artículo térmico conserva su descripción completa y muestra los campos
  numéricos configurados en líneas etiquetadas. Los identificadores largos se
  ajustan sin ampliar la tabla; los totales pasan a otra línea si hace falta.
  Las fuentes mantienen sus puntos físicos y no se reduce todo un diseño
  sobredimensionado para encajarlo en el rollo.
- En **Dispositivos**, Sistema y ESC/POS permiten activar impresión automática
  después de completar una venta; está desactivada inicialmente. Sistema abre
  el diálogo del sistema operativo. En escritorio se puede elegir una cola
  enumerada para ese negocio y equipo; el modo silencioso requiere esa
  selección. Los perfiles anteriores sin selección abren un diálogo. Si falta
  la cola guardada, falla sin elegir otra silenciosamente. ESC/POS ofrece un
  selector 58/80 mm sincronizado con su JSON avanzado.
- La red ESC/POS requiere la dirección privada real de la impresora. Las IP de
  ejemplo no se guardan como valores predeterminados. USB y serie directos no
  están implementados; para una impresora USB usa **Sistema** y su controlador.
  Cambiar de método conserva la elección de impresión automática y separa la
  configuración específica de cada método.
- **Verificar registro** no imprime. **Imprimir ticket de prueba** abre el
  diálogo del sistema para un documento sintético sin crear una venta. Una
  prueba fallida muestra diagnóstico y no se anuncia como exitosa. Consulta
  [Printer setup](PRINTER-SETUP.md) / [Configuración de impresoras](./PRINTER-SETUP.md).
- Electron usa el papel y área imprimible predeterminados de la impresora.
  El saneamiento conserva SVG estático de QR/códigos de barras y bloquea
  construcciones activas o recursos externos. Cancelar es un resultado separado,
  no un error del spooler.
- Un fallo de escritura ESC/POS conserva la cola persistente y sus reintentos;
  nunca abre otra copia HTML/Sistema. Solo confirma un reintento en cola cuando
  el servidor lo persistió. Un fallo de transporte o puente sin confirmación
  pide revisar impresora y cola antes de reimprimir. Sistema explícito y la ruta
  sin ESC/POS siguen usando HTML. Los fallos del puente local Hub no tienen
  reintento persistente. Si un trabajo ESC/POS encuentra la impresora cambiada
  a Sistema, queda con fallo definitivo y diagnóstico, conservando sus bytes.
  Verificar registro nunca lo completa; revisa la cola antes de cambiar de ruta.
- Las solicitudes simultáneas de una venta comparten el intento activo. Sigue
  siendo posible reimprimir deliberadamente después. La confirmación del
  navegador solo indica que abrió el diálogo, no que salió papel.
- Si la venta tiene documentos fiscales se elige la predeterminada activa
  `fiscal_dee`; en otro caso, `sale`. Si falta la plantilla fiscal activa,
  una venta fiscal usa la plantilla `sale` como alternativa.
- Navegador y Sistema de Electron piden HTML renderizado por el servidor con esa
  plantilla. Las impresoras del servidor y clientes Hub reciben bytes ESC/POS
  del mismo diseño y contexto de venta.
- La salida térmica respeta ancho, página de códigos, pulso de cajón y orden de
  corte configurados. QR y Code 128 resuelven el mismo origen en ambos formatos.
- Sin plantilla activa se conserva el HTML/ESC-POS anterior como alternativa
  de actualización, en vez de perder la impresión.
- Las reimpresiones usan importes y pagos contabilizados. Las ordinarias
  completadas usan instantáneas de cliente, sede, cajero, producto/SKU,
  empresa/datos fiscales/contacto, identificación del cliente, plantilla
  ordinaria, logo e idioma. Las versiones de instantáneas distinguen campos
  intencionalmente vacíos o falta de plantilla de una fila histórica; solo las
  anteriores a migraciones recurren a registros y presentación actuales.
  Las fiscales también usan comprador, líneas, total, moneda, idioma y fecha
  congelados, aunque su plantilla declarativa sigue la configuración fiscal
  actual. La evidencia fiscal se agrega como sección de prueba no eliminable:
  los documentos mock/borrador muestran identificador local, resolución,
  madurez y aviso de no transmisión. URLs y QR de autoridad no están disponibles
  hasta que el pack del proveedor esté certificado.
- El logo ordinario congela la URL o cadena `data:image`. Una imagen inline es
  autocontenida; la URL remota puede cambiar o desaparecer fuera de Puntovivo
  y no conserva una copia de sus bytes.

## Comportamiento actual del editor

La lista permite arrastrar con puntero y reordenar con teclado mediante
`@dnd-kit/core` y `@dnd-kit/sortable`. El control de arrastre mantiene operables
por separado el título y los controles de subir/bajar. El movimiento usa
`apps/web/src/lib/flipAnimate.ts`; con reducción de movimiento la transición es
instantánea.

El editor de texto CodeMirror 6 está en
`apps/web/src/features/receipt-templates/TextBlockEditor.tsx`. Ofrece llaves de
sustitución emparejadas, resaltado, autocompletado de espacios/propiedades/funciones
y validación inline traducida. Editor y servidor prueban la paridad de límites
y listas permitidas. La interfaz se carga de forma diferida en la ruta
administrativa; los tamaños de builds históricos no prueban el rendimiento actual.

### Contrato de expresiones

Dentro de `{{ … }}` se admite una ruta con puntos, un literal numérico/de texto
o una función permitida con anidamiento limitado. El parser no interpreta
JavaScript ni puede acceder a globales del entorno.

| Función                                          | Propósito                                                       |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `currency(value, decimals?)`                     | Formatea mediante el formateador monetario regional del recibo. |
| `date(value, pattern?)`                          | Formatea una cadena ISO, una fecha o milisegundos Unix.         |
| `upper(value)` / `lower(value)`                  | Cambia mayúsculas/minúsculas.                                   |
| `round(value, decimals?)`                        | Redondea una expresión numérica para mostrarla.                 |
| `limit(value, n)`                                | Limita caracteres Unicode y agrega puntos suspensivos si caben. |
| `concat(a, b, …)`                                | Concatena valores escalares.                                    |
| `default(value, fallback)`                       | Usa la alternativa si hay null, undefined o texto vacío.        |
| `abs(value)`                                     | Valor absoluto numérico.                                        |
| `max(a, b, …)` / `min(a, b, …)` / `sum(a, b, …)` | Agregación numérica.                                            |

Los límites son `MAX_EXPRESSION_LENGTH=200`, `MAX_FUNCTION_ARGS=8`,
`MAX_RECURSION_DEPTH=4` y `MAX_DECIMALS=20`. Antes de guardar y al evaluar se
validan aridad y espacios permitidos. Las funciones condicionales `if/eq/gt`
no están implementadas. El formato afecta a la presentación, no al cálculo
financiero persistido.

`currency()` usa el callback del renderer; la cantidad explícita de decimales
se limita a 0–20. `date()` admite tokens `yyyy / MM / dd / HH / mm / ss` y
`dateFormatShort` de la configuración regional, con alternativa `yyyy-MM-dd`.
`limit("hola mundo", 9)` devuelve `"hola m..."`.

El renderer resuelve propiedades propias, no campos de la cadena de prototipos.
El evaluador devuelve texto plano y `resolveAndEscape` aplica escape HTML al
resultado. Los orígenes de lector se validan en literales y después de resolver
para que concatenar texto no evite las restricciones de esquemas URL.

### Disponibilidad de variables y marca

El procedimiento administrativo `receiptTemplates.variableAvailability`
informa disponibilidad de `company`, `sale`, `item`, `fiscal` y `tender` según
la configuración. Los campos de venta/artículo/pago suelen estar disponibles al
renderizar; los valores opcionales de empresa dependen de su fila y los avisos
fiscales de la opción fiscal activa. Estos indicadores no certifican un
proveedor ni garantizan valores para todas las ventas. Las variables sin valor
se atenúan en el editor con explicación traducida; un error de sintaxis puede
mostrar además su marcador. La consulta admite 60 segundos de antigüedad y
actualiza decoraciones sin volver a montar el campo.

`appFooter` dibuja Puntovivo, URL y contacto de soporte desde
`APP_FOOTER_METADATA`. Ambos renderers respetan `show: false`. Aparece en diseños
predeterminados y se puede ocultar o eliminar. El recibo no imprime una versión
fija porque no existe una instantánea de versión de la aplicación al vender.
Una URL remota de logo es una referencia guardada, no un archivo de sus bytes.

## Evidencia de efectivo recibido y anchos históricos

Al completar un pago único en efectivo se congela el importe entregado y el
cambio devuelto, separados del pago neto y del ingreso de caja. El bloque de
pagos con `showChange` lo muestra en HTML, ESC/POS y texto compartido. Los
borradores no capturan entrega de dinero; los pagos divididos o distintos del
efectivo no la infieren. Los recibos anteriores a esas instantáneas nullable
conservan su comportamiento sin inventar efectivo recibido.

El recibo ordinario conserva presentación y ancho guardados al completar la
venta. Elegir una plantilla de 58 mm afecta ventas nuevas; no reescribe un
recibo existente de 80 mm. Para Sistema, selecciona dimensiones coincidentes
en el controlador del sistema operativo. Las medidas de PDF no establecen
el ancho útil ni la alimentación de una impresora física.

ESC/POS usa el ancho del periférico seleccionado para redistribuir el contenido
guardado en 32 o 48 columnas. Esa adaptación no reescribe la instantánea de
presentación. Un trabajo en cola conserva los bytes que capturó al crearse;
cambiar la plantilla no los regenera.
