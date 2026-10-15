# 0017: perfiles verticales, precisión y autoridad GS1 por sede

**Idioma:** Español · [English](../../architecture/0017-vertical-profiles-site-gs1.md)

> Estado: aceptada
> Fecha: 1 de septiembre de 2026

## Contexto

Ferreterías y carnicerías comparten núcleos de venta, inventario, compra y caja,
pero difieren al ingresar catálogo. Ferretería necesita longitud, serie o lote;
carnicería, milésimas, trazabilidad y etiquetas cuyo prefijo 20–29 configura la balanza de cada sede.

Elegir perfil no debe reescribir catálogo existente. Confiar GS1 al renderer
permitiría interpretar precio como peso; distintas sedes pueden tener diseños
diferentes. Lectores existentes pueden no tener mapa, y políticas históricas
positivas ser más finas que los nuevos valores de interfaz.

## Decisión

### Perfiles y plantillas de producto

- El conjunto cerrado agrega `hardware` y `butchery` a minorista, restaurante,
  servicio rápido y mayorista.
- Aplicar guarda `tenant.settings.businessType` y solo cambia parche de módulos
  del servidor. Ferretería activa cotizaciones/operaciones; carnicería,
  POS Touch/operaciones. Ambas desactivan superficies de restaurante.
- Nunca crea, renombra ni cambia categorías, productos, unidades, precios,
  stock, lotes o series. IA e integraciones quedan fuera del parche.
- Solo el perfil correspondiente ofrece plantillas explícitas de producto.
  Cambian formulario sin guardar, resuelven unidad activa por abreviatura
  normalizada/dimensión, conservan niveles 2/3 y no cambian nada si falta unidad
  compatible. Pesados exigen factor de masa positivo igual al validado por lector.
- Solo configuran artículo vendible; no consumen ni afirman rendimiento,
  desperdicio, corte, receta, remanente o transformación. Eso usa el motor
  transaccional de [ADR-0018](../../architecture/0018-lot-procurement-and-transformations.md);
  aplicar plantilla no crea receta ni ejecuta stock.

### Precisión de cantidades

- `0.001` es el menor incremento expuesto en producto, unidad, carrito, compra y orden.
- Es capacidad de entrada/renderer, no nuevo mínimo de rechazo del servidor.
  Conserva toda política histórica positiva válida y valida contra paso/mínimo guardados.
- Cantidad e importes son independientes: venta, compra u orden conserva
  `0.001` mientras dinero pasa por `roundMoney` de dos decimales.

### Decodificación GS1 autoritativa por sede

- Lector activo tipo teclado puede guardar mapa opcional no superpuesto de
  prefijos internos 20–29 a `weight` o `price`; los omitidos son EAN-13 ordinarios.
- Sin mapa explícito, compatibilidad par=peso, impar=precio. `gs1Scheme: none`
  desactiva interpretación embebida.
- Lookup recibe código crudo y política de parseo, no mapa. Para 13 dígitos 2x,
  servidor resuelve lector activo por `tenantId + ctx.siteId`, lee configuración
  persistida y decodifica. Renderer no sustituye mapa.
- Peso está en kg. Exige unidad base explícita `mass` y factor positivo por
  gramos canónicos. Solo cantidad base convertida se valida contra política
  fraccionaria. Falta, dimensión ajena, unidad entera, mínimo o paso inválido
  rechaza antes de crear línea.
- Solo resuelve el código propio de producto de cinco dígitos, nunca empaque;
  combinar cantidad de balanza y equivalencia ajena corrompería stock.
- Precio codificado es precio de un paquete entero. Producto fraccionario lo
  rechaza por falta de cantidad defendible; debe usar prefijo de peso. En
  carrito es precio unitario con impuesto inclusivo/exclusivo normal del negocio,
  sin eximir controles de modificación de precio.
- Lector ausente en sede válida conserva compatibilidad. Sin sede activa no
  interpreta embebido; configuración activa antigua ambigua/malformada vuelve
  a EAN ordinario sin adivinar rol.
- Repetir peso suma cantidad convertida exacta. Paquetes de precio usan identidad
  normalizada a centavos: iguales incrementan línea; distintos quedan separados.
  IDs congelados conservan filas repetidas producto/unidad tras suspender/reanudar.
- Código ordinario o texto no consulta configuración; lectura extra indexada
  solo para candidatos 2x de 13 dígitos.
- Nombres de país son selectores compatibles del diseño genérico de cinco
  dígitos SKU/cinco payload; no certifican toda balanza CO/MX/CL.

## Consecuencias

- Perfil es configuración reversible, sin dañar catálogo.
- Estado confirmado se refleja en sesión para mostrar plantilla inmediatamente;
  `auth.me` conserva autoridad al recargar.
- Cajero no cambia semántica precio/cantidad por entrada; configuraciones de
  sedes no se filtran entre negocios/sedes.
- Kg no se aplica directamente a metros, piezas, unidad sin clasificar o
  empaque. Primero clasifica base; kg/g se convierten por factor almacenado.
- Configuración vacía conserva historia; corrupta exige reparación, no reinterpretación silenciosa.
- Omnibox y caja comparten resolución del carrito. Código normal respeta nivel
  explícito del cliente; precio GS1 queda override congelado. Cajero requiere
  permiso gerente `sale_price_override` ligado a carrito, cliente, medios y
  total exactos. Manager/admin conserva autoridad directa; cotización aceptada
  conserva autorización original. Borrador viejo sin precio de catálogo
  congelado rechaza override no verificable. Preflight deriva acción visible
  del catálogo actual o instantáneas, no metadatos del renderer; completar
  repite independientemente. Leer orienta, no autoriza.
- Parser/fixtures no homologan balanza, lector, etiqueta, metrología ni impresora físicos.

## Alternativas rechazadas

- **Crear catálogo al elegir perfil:** muta silenciosamente tienda existente.
- **Mapa desde React:** confía dinero/cantidad a cliente viejo o modificado.
- **Un mapa global por negocio:** rompe sedes con distinta balanza/firmware.
- **Mínimo servidor universal 0.001:** rechaza historia válida y confunde UI con dominio.
- **Cortar mediante plantilla:** no prueba atomicidad de entradas/lotes,
  salidas, rendimiento, desperdicio y costo; el motor dedicado separa evidencia.

## Evidencia de verificación

- `packages/shared/src/vertical-product-templates.test.ts`,
  `packages/shared/src/gs1.test.ts` y unidades fijan contratos y compatibilidad.
- `packages/server/src/__tests__/module-presets.test.ts` prueba parches y
  catálogos intactos tras cambiar perfiles consecutivamente.
- `packages/server/src/__tests__/products-lookupByBarcode.test.ts`,
  `peripherals-router.test.ts`, `peripherals-registry.test.ts` y
  `peripherals-barcode-parser.test.ts` fijan negocio/sede, compatibilidad,
  rechazo de filas inválidas y configuración tipada.
- Regresiones de venta, compra, orden, fracción, formulario, carrito, lector,
  periféricos y sesión conservan milésimas, plantilla explícita y perfil inmediato.
- Aprobaciones integradas cubren catálogo, borradores congelados, permiso
  exacto de un uso, auditoría inmutable, metadatos viejos y consulta a negocio ajeno.
- Una comprobación Chromium autenticada aislada aplicó ambos perfiles,
  creó/recargó MT/KG, guardó mapa por sede y envió ráfaga cruda que agregó
  `0.199 kg` con decode del servidor; la continuación final no tuvo errores de cliente.
