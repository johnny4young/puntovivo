# 0012: frescura externa de la cadena de auditoría

**Idioma:** Español · [English](../../architecture/0012-audit-chain-external-freshness.md)

> Estado: aceptada
> Fecha: 28 de agosto de 2026

## Contexto

Una cadena append-only dentro de SQLite prueba enlaces internos, no el retorno
a una instantánea completa anterior coherente. Puntovivo escribe auditoría en
transacciones BetterSQLite3 síncronas, restaura cifrado y comparte base dev entre
entornos. El ancla debe sobrevivir fuera sin convertir una escritura externa
al llavero en afirmación no confirmada.

La cadena es global por negocio en su base. Sincronizar negocio ordinario no
permite combinar auditorías independientes de varios dispositivos sin ramas;
la identidad del equipo debe entrar en el modelo de confianza.

## Decisión

El servidor define `AuditAnchorStore` opcional versionado por negocio fuera de
SQLite. Electron empaquetado sella mediante `safeStorage` y publica atómicamente
con permisos solo del propietario. Detectar retroceso externo solo aplica con
ese almacén persistente. Independiente con solo HMAC prueba enlaces, no frescura
contra rollback completo. El sobre contiene:

- Contador monotónico y cabeza confirmados.
- Lista ordenada de reservas contador/cabeza, con todo candidato previo a liquidar transacción.
- Versión estricta de esquema y registros por clave de negocio.

Lee sobre v1 de reserva única y escribe v2 en la siguiente mutación, sin perder
la evidencia externa instalada.

Toda transacción auditada:

1. Concilia cabeza de base y estado externo confirmado/pendiente.
2. Reserva siguiente contador externo antes de avanzar cabeza.
3. Incluye `anchorCounter` en HMAC canónico.
4. Avanza `audit_chain_heads` mediante comparación/intercambio versionado dentro
   de la misma transacción de negocio.
5. Confirma reserva externa solo después de retornar el commit síncrono.

Solo acepta estados acotados de caída antes de commit o después y antes de
confirmar. Tras adoptar negocio, estado ausente, retrocedido, divergente,
malformado o ajeno rechaza. Las filas posteriores a adopción deben tener cadena.

Fallar CAS de cabeza aborta el negocio auditado completo. No se reintenta solo
la cabeza, pues separaría evento y cambio. Un futuro driver podría reintentar
el comando completo desde su límite transaccional.

Aplicación remota/combinada de `audit_logs` está bloqueada hasta definir cabezas
por equipo, pruebas de combinación y conciliación anclada externamente.

## Verificación y escala

Verificar parte de cabeza autenticada y recorre hacia atrás
`idx_audit_logs_chain_hash` en páginas de 512, solo columnas canónicas. Cede
entre páginas y deriva hashes grandes a worker breve. Llamadas se comparten
por base/negocio y se limitan inicios administrativos; no se cachea éxito entre
llamadas. Relee cabeza, contador, versión, adopción y recuento antes de devolver
éxito para no ocultar una mutación externa tras resultado viejo.

Ocultar datos privados conserva reescritura completa en transacción atómica del
llamador. Temporales de conexión y páginas acotadas reemplazan historia completa
en JavaScript. El perfil serial de 100,000 filas controla tiempo, cesión del
bucle, plan de índices, limpieza y RSS acumulado.

Evidencia requerida:

- Pruebas de ancla/almacén, cadena, caída, bloqueo de sync y migración.
- `pnpm run ci:server`.
- `pnpm run ci:desktop`.
- Gate de 100,000 filas `perf-budget.json::auditChainProfile`.

## Consecuencias

- Una base vieja copiada no se acepta solo por cadena interna coherente.
- Restaurar reemplaza explícitamente ancla y base validada; inicio ordinario no adopta silenciosamente otra cadena.
- Disponibilidad `safeStorage` y archivo de ancla son parte de continuidad y evidencia representativa de recuperación.
- El trabajo es acotado y no bloqueante, pero lee fresco en cada solicitud administrativa.
- Auditoría multidispositivo sigue no disponible en vez de crear historia combinada no verificable.

## Alternativas rechazadas

- **Cabeza solo en SQLite:** retroceder restaura filas y cabeza coherentes.
- **Cabeza externa después sin reserva:** caída deja avance ambiguo, indistinguible de manipulación.
- **Cabeza final externa antes:** fallo del negocio deja afirmación de una cabeza inexistente.
- **Cachear veredicto correcto:** mutación por otro proceso tras primera llamada quedaría invisible.
- **Combinar filas remotas en una cadena:** ordenar no demuestra qué equipo produjo/ancló una rama.
