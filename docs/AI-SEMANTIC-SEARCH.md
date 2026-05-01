# Búsqueda semántica + auto-categorización (ENG-033)

> Status: **Shipped** (ENG-033) — backend completo (schema +
> service + tRPC + tests). La superficie de búsqueda en
> `ProductsPage` se conectó después en `ENG-048`; la sugerencia de
> categoría al crear producto sigue como follow-up de UI.

## Resumen ejecutivo

Cuando un cajero busca "vino tinto reserva", la búsqueda LIKE actual
solo encuentra productos cuyo nombre o SKU **contiene literalmente**
ese string. Si el producto se llama "Cosecha tinto premium 2020",
queda invisible. La búsqueda semántica resuelve eso comparando
**vectores** que codifican el significado del texto, no la cadena
exacta — productos cercanos en concepto aparecen primero aún si las
palabras difieren.

Además, al crear un producto nuevo, el sistema sugiere la categoría
fiscal apropiada con un nivel de confianza, ahorrando al admin la
tarea de elegir manualmente entre catálogos largos.

Ambas features están **detrás del flag `ai.enabled`** y requieren un
proveedor con soporte de embeddings — hoy solo **OpenAI** ship con
`embeddingModel`. Anthropic no embebe; un tenant en Anthropic cae
de regreso a la búsqueda LIKE sin error.

## Por qué se implementó — casos de uso LATAM

La búsqueda LIKE clásica falla cuando el cajero o manager no recuerda
el nombre exacto y escribe por intención. Los siguientes ejemplos
salen de pruebas con catálogos seed (`admin@demo.co`) y reflejan el
input típico de un POS LATAM:

| Lo que escribe | Lo que quiere ver | Por qué LIKE falla |
|---|---|---|
| `bebida fría` | Cocas, jugos, aguas | Ningún producto contiene la palabra "bebida" en el nombre |
| `algo dulce` | Chocolates, caramelos, mermeladas | "Dulce" no aparece textual en el catálogo |
| `para limpiar el baño` | Jabones, cloros, detergentes | La intención no se traduce a substring exacto |
| `desayuno rápido` | Pan, leche, café, cereal | Conceptos compuestos sin palabra-clave compartida |
| `lácteo light` | Leche descremada, yogur sin azúcar | Sinónimo regional ("light" ≈ "descremada") |

Embeddings además resuelven gratis cuatro escenarios que LIKE
tampoco maneja:

- **Sinónimos regionales**: "gaseosa" ≈ "soda" ≈ "bebida carbonatada"
  (CO/MX/AR usan los tres).
- **Errores de tipeo**: "yougur" sigue cerca de "yogur" en el espacio
  vectorial — el modelo aprendió tolerancia a typos.
- **Mixto multilingüe**: `text-embedding-3-small` mezcla
  español/inglés/portugués. Tenant brasilero puede buscar "leite"
  contra catálogo en español y matchear "leche".
- **Conceptos compuestos**: "para fiesta infantil" rankea globos +
  dulces + servilletas decoradas — cosas que ningún LIKE de tres
  campos atrapa.

Esta es la justificación de negocio. Ver
`apps/web/src/features/products/ProductsPage.tsx` (ENG-048) para la
UI que expone el toggle.

## Cómo funciona

### Embedding storage

Cada producto carga tres columnas nuevas (migración `0009`):

- `embedding TEXT` — array JSON con 1536 floats (~6 KB) producido por
  `text-embedding-3-small` de OpenAI.
- `embedding_model TEXT` — id del modelo que generó el vector
  (`text-embedding-3-small` por default). Si en el futuro upgrade
  a `text-embedding-3-large`, el cambio se detecta y se re-embebe.
- `embedded_at TEXT` — timestamp ISO de la última vez que se generó.

Las tres son nullables — un producto sin embedding cae a búsqueda
LIKE en su lugar.

### Texto canónico

`productCanonicalText({name, description, sku})` arma el string que
se embebe: `"name — description — sku"`. La fórmula es estable —
cambiar la fórmula desincroniza queries con productos ya embebidos,
así que cualquier ajuste obliga a un re-embed completo.

### Cosine similarity

`dot(a, b) / (||a|| * ||b||)` ∈ `[-1, 1]`. Para vectores normalizados
(que es lo que devuelve OpenAI), esto es idéntico al producto punto
y muy barato. Floor de `0.30` filtra resultados poco relacionados
antes de devolver el top-K (default 25, máximo 50). El cómputo se
hace en JS sobre todas las filas embebidas del tenant — para
catálogos hasta ~50k productos esto se queda bajo 100ms en SQLite
embebido.

### Auto-categorización

`generateObject({schema: z.object({categoryId: z.enum(...)})})`
fuerza al modelo a elegir entre las categorías existentes del
tenant — no puede inventar una nueva. Devuelve `{categoryId,
confidence: 0..1}`; el frontend decide si mostrar la sugerencia
basado en el threshold (recomendado: aceptar > 0.7, sugerir entre
0.4-0.7, ignorar < 0.4).

## Dimensiones

- 1536 dims × 4 bytes/float = ~6 KB por producto serializado como
  JSON. 1000 productos = ~6 MB. SQLite embebido lo maneja sin
  problema.
- Costo de embedding: $0.02 por 1M de tokens input bajo
  `text-embedding-3-small`. Un nombre + descripción típico son
  ~30-80 tokens; embedber 1000 productos cuesta ~$0.0016. Re-embed
  full catalog es trivial en costo.
- Latencia: `embedQuery` (1 string) ~80ms. `embedMany` (256
  strings) ~300ms. La búsqueda local es <100ms para catálogos
  típicos.

## API

```
products.semanticSearch({ query: string, limit?: number })
  → { mode: 'semantic' | 'unavailable', results: Product[] }

products.regenerateEmbeddings()
  → { ok: true, embedded: number, model: string }
   | { ok: false, reason: 'ai-disabled-or-empty', embedded: 0 }

products.suggestCategory({ name, description? })
  → { ok: true, suggestion: { categoryId, confidence } }
   | { ok: false, suggestion: null }
```

`semanticSearch` y `suggestCategory` son **manager+ only**
(`managerOrAdminProcedure`). `regenerateEmbeddings` es admin-only
(es un batch costoso que toca toda la tabla).

## Cuándo NO aplica

- `ai.enabled = false`: las tres procedures retornan `unavailable`
  o `ok=false` sin error.
- Tenant en Anthropic puro: `embeddingModel` no existe en el
  provider → `semanticSearch` retorna `unavailable` y
  `regenerateEmbeddings` / `suggestCategory` retornan `ok=false`.
- Tenant con cero productos: `regenerateEmbeddings` retorna
  `embedded: 0` sin error.
- Tenant con productos pero sin embeddings todavía:
  `semanticSearch` corre la query embebida pero no encuentra
  matches; el caller debe caer a LIKE en `products.list`.

## Roadmap interno (follow-ups capturados)

- **Búsqueda en UI**: `ENG-048` hookea `semanticSearch` en
  `ProductsPage` con toggle semántico, input dedicado, columna
  `Coincidencia` y fallback literal via `products.list` cuando
  retorna `unavailable`.
- **Auto-categorización en UI**: conectar `suggestCategory` al modal
  de creación/edición de productos para preseleccionar categoría con
  threshold de confianza. Capturado en BACKLOG.
- **Auto-embed on upsert**: cuando se crea/actualiza un producto,
  embeber automáticamente. Hoy es manual via
  `regenerateEmbeddings`. Captured en BACKLOG.
- **Vector index**: para catálogos > 50k, considerar
  `sqlite-vec` extension o columna BLOB con índice anchorado.
  Capturado en BACKLOG.
- **Staleness reembed**: detectar cuando `embedding_model` no
  matchea el modelo configurado actualmente y re-embeber sólo
  esas filas. Capturado en BACKLOG.

## Referencias

- `packages/server/src/services/ai/embeddings.ts` — service.
- `packages/server/src/services/ai/embeddings.test.ts` — tests
  unitarios cosine + parse + canonical text.
- `packages/server/src/db/migrations/0009_product_embeddings.sql`.
- `docs/ROADMAP.md §3b ENG-033`.
- ACFE / OpenAI pricing: `text-embedding-3-small` $0.02 / 1M
  tokens, `text-embedding-3-large` $0.13 / 1M tokens.

## Changelog

- **2026-04-30 (ENG-033)** — primera versión. Schema migration +
  service con cosine + tRPC con `semanticSearch`,
  `regenerateEmbeddings`, `suggestCategory`. Búsqueda UI diferida.
- **2026-04-30 (ENG-048)** — `ProductsPage` conecta el flujo de
  búsqueda semántica y regeneración de embeddings. La UI de
  auto-categorización queda como follow-up.
