# Fixtures del benchmark OCR

**Idioma:** Español · [English](README.md)

10 facturas sintéticas usadas por `benchmark:invoice-ocr` en
`packages/server/scripts/benchmark-invoice-ocr.ts`. Cada fixture tiene tres archivos:

| Archivo          | Función                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `NN-<slug>.html` | Plantilla fuente que representa un ticket/factura realista latinoamericano.                      |
| `NN-<slug>.png`  | Imagen renderizada que la CLI entrega a `extractInvoiceFromImage`. **Versionada: no la borres.** |
| `NN-<slug>.json` | Verdad etiquetada manualmente: proveedor y array `lines` canónico.                               |

## Matriz de variedad

| #   | Slug          | País | Líneas | Particularidad                                         |
| --- | ------------- | ---- | ------ | ------------------------------------------------------ |
| 01  | cafe-mx       | MX   | 3      | Ticket pequeño, MXN, IVA 16%.                          |
| 02  | super-co      | CO   | 7      | Factura mediana, COP, IVA 19%.                         |
| 03  | bakery-cl     | CL   | 4      | CLP y punto de separación de miles.                    |
| 04  | hardware-pe   | PE   | 6      | PEN, líneas mixtas kg/unidad.                          |
| 05  | pharmacy-mx   | MX   | 5      | Letra pequeña, columnas genérico/marca.                |
| 06  | farmacia-co   | CO   | 4      | Línea de descuento; la verdad solo conserva productos. |
| 07  | restaurant-mx | MX   | 8      | Ticket grande con propina explícita.                   |
| 08  | minimart-cl   | CL   | 3      | Diseño mínimo sin desglose por línea.                  |
| 09  | wholesale-co  | CO   | 9      | Factura mayorista con columna SKU.                     |
| 10  | corner-mx     | MX   | 2      | Ticket muy pequeño y de bajo contraste, difícil.       |

Las 10 facturas suman 51 líneas de verdad.

## Regenerar PNG

Si cambia una plantilla, renderiza su PNG con el script del workspace:

```
node packages/server/scripts/generate-invoice-ocr-fixtures.mjs
```

Usa Playwright de la raíz, paquete `playwright` ya incluido para E2E. Enumera cada `*.html` de este
directorio y escribe su `*.png` mediante capturas Chromium.

## Ejecutar el benchmark

Proporciona la clave de API mediante un entorno de proceso privado. Nunca
versiones ni incluyas su valor en comandos, capturas o informes. Es un benchmark
opcional con proveedor real, no una comprobación documental obligatoria sin conexión.

```
pnpm --filter @puntovivo/server run benchmark:invoice-ocr
```

Aceptación: precisión agregada ≥ 0.80, suma de coincidencias dividida por suma
de verdad de los 10 fixtures. Código `0` si pasa y `1` si falla. Las llamadas
reales a visión OpenAI usan un negocio de benchmark aislado en memoria y su
presupuesto configurado. Los cargos dependen del modelo y uso; la CLI informa el costo medido.
