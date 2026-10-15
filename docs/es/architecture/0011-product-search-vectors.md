# 0011: almacenamiento vectorial de productos y selección de modelo

**Idioma:** Español · [English](../../architecture/0011-product-search-vectors.md)

> Estado: aceptada
> Fecha: 8 de agosto de 2026

## Contexto

Buscar productos interactivamente es sensible a latencia/memoria en escritorio
con autoridad local. ADR-0001 conserva SQLite y Node/Electron requieren
verificación separada aunque compartan prebuild Node-API portable. Agregar una
extensión afecta cifrado, migraciones, empaquetado, Node 24, Electron 43 y los
tres sistemas, no solo una consulta.

Antes cada embedding era un array JSON decimal. Tampoco había comparación
retenida del dominio para elegir modelo local. Rankings generales ayudan a
descubrir, pero no miden español latinoamericano neutro, consultas cruzadas
ni distractores de Puntovivo.

## Decisión

Nuevos embeddings se guardan como BLOB SQLite float32 versionado `PVEC`; JSON
heredado sigue legible al actualizar. No se añade base vectorial ni extensión.

Búsqueda semántica mantiene shortlist literal por negocio y techo estricto de
200 candidatos. Solo ese conjunto se decodifica y ordena por coseno en JavaScript.
Los vectores son datos derivados, no autoridad fiscal ni de sincronización.

La selección de código exacto usa caché débil propiedad de conexión de sentencias
parametrizadas, limitada a 32 combinaciones de filtros. SKU, código base,
empaque y registro sanitario tienen carriles indexados independientes con
límites propios; prioridad estable y deduplicación preceden límite final.
Negocio, filtros, consulta y límite se ligan en cada llamada, sin cachear
resultados ni valores permanentes. Perfil farmacéutico y propiedad siguen protegidos separadamente.

Es recuperación híbrida, no vecinos aproximados de todo el catálogo. Debe
compartirse término exacto, FTS o subcadena antes de reordenar por embedding;
un concepto sin coincidencia literal puede no devolver nada. La interfaz lo
explica sin prometer recuperación semántica global inexistente.

`PVEC` v1 es portable:

- Magic `PVEC` de cuatro bytes, formato/codificación, reservados cero y dimensión unsigned little-endian.
- Elementos IEEE-754 float32 escritos little-endian explícitamente.
- Máximo 8,192 dimensiones y longitud exacta de payload.
- Rechazo de versiones no admitidas, truncamiento, bytes extra y valores no finitos.
- Fallback JSON hasta regeneración explícita que escribe BLOB y limpia valor viejo.

Ollama usa `embeddinggemma` predeterminado; OpenAI conserva
`text-embedding-3-small`. Cambiar proveedor/modelo requiere regeneración explícita:
igual dimensión no implica espacios vectoriales compatibles.

## Evidencia del dominio

El corpus retenido tiene 36 productos y 24 consultas graduadas de abarrotes,
farmacia, ferretería y electrónica: español neutro, inglés hacia español,
sinónimos y distractores cercanos. Mide nDCG@10, recall@3, MRR, precisión top-1,
diez resultados completos, dimensiones, almacenamiento y latencia de lote.

En evidencia local del 8 de agosto de 2026, `embeddinggemma` lideró los cuatro modelos Ollama:

| Modelo                 | Dimensiones |  nDCG@10 | Recall@3 |      MRR |    Top-1 |
| ---------------------- | ----------: | -------: | -------: | -------: | -------: |
| `embeddinggemma`       |         768 | 0.961299 | 1.000000 | 0.944444 | 0.916667 |
| `qwen3-embedding:0.6b` |       1,024 | 0.855279 | 0.937500 | 0.815972 | 0.666667 |
| `nomic-embed-text`     |         768 | 0.767351 | 0.729167 | 0.780989 | 0.750000 |
| `all-minilm`           |         384 | 0.618853 | 0.625000 | 0.605049 | 0.541667 |

El calentamiento observado fue 0.58–8.74 segundos, sensible al orden, caché y
equipo: sirve al diagnóstico, no es SLA ni clasificación determinista. Si falla
proveedor, se conserva la alternativa honesta de búsqueda literal.

El benchmark generó vectores normalizados deterministas de 384, 768, 1,024,
1,536, 3,072 y 4,096 dimensiones; decodificó/ordenó 200 candidatos en 30 muestras.
`PVEC` redujo 80.66–81.29% del JSON decimal, conservó recall@10 1.0, error de
coseno menor de `5e-9` y redujo p95. A 768 usó 3,084 bytes/vector y 0.4993 ms,
frente a 16,159.09 bytes y 5.2705 ms JSON. A 1,536 usó 6,156 bytes, no el supuesto
JSON de 6 KB: JSON medido fue 32,525.6 bytes.

Informes y hash del corpus están fijados por pruebas:

- `docs/assets/benchmarks/product-embeddings-ollama-2026-08-09.json`
- `docs/assets/benchmarks/vector-storage-2026-08-09.json`
- `packages/server/src/perf/product-embedding-evidence.test.ts`

## Comparación de mercado

Documentación primaria ayuda a descubrir; no es benchmark retenido de Puntovivo.
Verifica especificaciones actuales de proveedor/modelo antes de evaluar:

- [Embeddings Ollama](https://docs.ollama.com/capabilities/embeddings).
- [Embeddings OpenAI](https://developers.openai.com/api/docs/guides/embeddings).
- [Embeddings Gemini](https://ai.google.dev/gemini-api/docs/embeddings).
- [Embeddings Voyage](https://docs.voyageai.com/docs/embeddings).
- [Cohere Embed](https://docs.cohere.com/docs/cohere-embed).

No se elige nube por marketing o rankings. Debe correr el mismo corpus con
credenciales reales, registrar costo/latencia y cumplir o mejorar relevancia
retenida antes de reemplazar un valor activo.

## Alternativas rechazadas por ahora

- **JSON decimal:** gasta unas cinco veces más y ralentiza decodificación/orden
  acotados sin mejorar portabilidad.
- **Vista typed-array nativa cruda:** deja implícitos orden, tipo y dimensión,
  dificultando rechazar corrupción o incompatibilidad.
- **[sqlite-vec](https://github.com/asg017/sqlite-vec):** dirección posible,
  pero agrega extensión nativa a cada objetivo. El conjunto acotado no prueba necesitar ese riesgo.
- **[libSQL](https://docs.turso.tech/libsql):** vectores no compensan cambiar
  autoridad cifrada, Drizzle/migraciones, respaldo y matriz de escritorio.
- **[pgvector](https://github.com/pgvector/pgvector):** índices pertenecen a
  PostgreSQL; autoridad remota viola el límite sin conexión y añade dependencia por pulsación.

## Consecuencias y condición de revisión

- `0037_product_embedding_blob` es aditiva. JSON sigue legible y solo cambia al
  regenerar. Se valida todo el lote y reemplaza catálogo del negocio en una
  transacción; un fallo de codec/escritura no deja modelos/formatos mezclados.
- BLOB corrupto no rompe búsqueda: se omite o usa JSON válido. Salud y divergencia
  de modelo siguen visibles a gerentes/administradores.
- Float32 pierde precisión acotada; las pruebas de recall/error hacen explícito el compromiso.
- Calidad Ollama solo probada para corpus v1 y digests registrados. Cambiar
  corpus/modelo exige nueva evidencia, no editar el informe.
- Reconsidera índices vectoriales solo si evidencia semejante a producción
  muestra insuficiente relevancia o presupuesto con 200 candidatos en 50,000
  productos. Requiere mismo benchmark, instalación limpia, verificación nativa,
  empaquetado, migración, respaldo/restauración y smoke en Node 24, Electron 43,
  Linux, Windows y macOS Sequoia/Tahoe admitidos.
- Fallos repetidos por solo significado motivan revisar; no justifican leer y
  decodificar sin límite todo el catálogo.

## Verificación

- `pnpm --filter @puntovivo/server run benchmark:vector-storage -- --output=<path>`
- `pnpm --filter @puntovivo/server run benchmark:product-embeddings -- --models=<models> --output=<path>`
- `pnpm run ci:server`
- `pnpm run ci:desktop`
