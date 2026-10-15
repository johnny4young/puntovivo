# Webhooks

**Idioma:** Español · [English](../WEBHOOKS.md)

Puntovivo puede entregar un conjunto pequeño y versionado de eventos de negocio
y transiciones de alertas operativas con datos limitados a un endpoint HTTPS
del comerciante. Es entrega saliente, no una API REST general: la aplicación sigue usando tRPC.

## Disponibilidad y seguridad

- Un administrador activa el módulo opcional Events API y crea una suscripción a URL HTTPS fija.
- Crear suscripciones en producción requiere la clave estable de cifrado de base.
  Los secretos de firma se sellan con AES-256-GCM y se muestran una sola vez.
- El destino se resuelve al guardarlo y antes de cada intento. Se rechazan
  loopback, privados, link-local, reservados, `.local`, credenciales, destinos
  sin HTTPS, puertos propios, fragmentos y redirecciones.
- Payloads y secretos no entran en logs de entrega. Se muestran identificadores,
  estado, recuento de intentos, estado HTTP, código de error y fechas.

## Sobre

Versión del contrato: **1**

```json
{
  "id": "webhook_outbox_id",
  "type": "sale.completed",
  "version": 1,
  "occurredAt": "2026-08-01T14:30:00.000Z",
  "data": {}
}
```

Cada POST incluye:

| Cabecera                 | Significado                                                        |
| ------------------------ | ------------------------------------------------------------------ |
| `Idempotency-Key`        | Identidad estable de entrega; guárdala antes de aplicar el evento. |
| `X-Puntovivo-Event-Id`   | Identificador estable de evento.                                   |
| `X-Puntovivo-Event-Type` | Tipo del manifiesto siguiente.                                     |
| `X-Puntovivo-Timestamp`  | Fecha/hora de firma ISO 8601.                                      |
| `X-Puntovivo-Signature`  | `v1=` más digest HMAC-SHA256 en minúsculas.                        |

Los bytes firmados son exactamente `timestamp + "." + rawRequestBody`. Verifica
contra el cuerpo crudo antes de analizar JSON, compara en tiempo constante,
rechaza fechas antiguas según tu política de reloj y deduplica por clave de idempotencia.

Los eventos de negocio usan `eventId:subscriptionId` como clave. Las transiciones
operativas usan el ID dedicado de entrega porque cada fila ya pertenece a una
suscripción. En ambos casos permanece estable en todos los reintentos de esa entrega.

## Esquema de eventos

El manifiesto Zod del servidor en
`packages/server/src/services/events/manifest.ts` es la fuente de verdad.
La prueba de contrato documental impide que esta lista diverja.

### `sale.completed`

Requeridos: `saleId`, `saleNumber`, `siteId`, `cashSessionId`, `customerId`
(nullable), `subtotal`, `taxAmount`, `discountAmount`, `total`, `currencyCode`,
`paymentMethod`, `completedAt`.

### `sale.refunded`

Requeridos: `saleReturnId`, `originalSaleId`, `siteId`, `cashSessionId`,
`refundedAmount`, `currencyCode`, `reasonCode` (nullable), `refundedAt`.

### `inventory.adjusted`

Requeridos: `productId`, `siteId`, `locationId` (nullable), `quantityBefore`,
`quantityAfter`, `delta`, `reasonCode` (nullable), `adjustedByUserId`, `adjustedAt`.

### `cash_session.closed`

Requeridos: `cashSessionId`, `siteId`, `cashierId`, `openedAt`, `closedAt`,
`expectedCashBalance`, `countedCashBalance`, `overShortAmount`, `currencyCode`.

### `fiscal_document.accepted`

Requeridos: `fiscalDocumentId`, `cufe`, `documentNumber`, `source`, `sourceId`,
`countryCode`, `providerId`, `acceptedAt`.

### Transiciones de alertas operativas

- `operational_alert.opened`
- `operational_alert.escalated`
- `operational_alert.acknowledged`
- `operational_alert.resolved`

Cada transición solo incluye `alertId`, `area`, `severity`, `status`, `count`,
`recoveryPath` y `occurredAt`. No contiene clientes, líneas de venta, credenciales,
direcciones de destino ni cuerpos de respuesta del proveedor. Reconocer registra
que un operador revisó el incidente; nunca oculta la señal de Operaciones.
Un incidente resuelto que reaparece recibe una identidad nueva.

## Ejemplos de verificación

### Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyPuntovivo(rawBody, timestamp, received, secret) {
  const expected = `v1=${createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
```

### Python

```python
import hashlib, hmac

def verify_puntovivo(raw_body: bytes, timestamp: str, received: str, secret: str) -> bool:
    signed = timestamp.encode() + b"." + raw_body
    expected = "v1=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received)
```

### Receptor local con curl

Usa curl solo para ejercitar tu receptor; Puntovivo envía la solicitud firmada.
Conserva los bytes crudos en el receptor:

```bash
curl --request POST https://your-domain.example/puntovivo \
  --header 'content-type: application/json' \
  --data-binary @fixture.json
```

## Entrega, reintentos y recuperación

Un 2xx se considera entregado. HTTP 408, 429, 5xx, fallos de red y timeouts
reintentan aproximadamente tras 30 segundos, 2 minutos, 10 minutos, 1 hora y
6 horas. El sexto fallo es definitivo. Otros 4xx y rechazos de política de
destino producen fallo definitivo inmediatamente.

Los pares suscripción/evento ya entregados nunca se reenvían mientras otro
suscriptor reintenta. `events.listDeliveries` usa `limit` (1–200) y `offset`
(0–10,000), del más nuevo al más antiguo. Un administrador reintenta un fallo
definitivo, desactiva o revoca la suscripción. Revocar destruye el secreto
sellado irreversiblemente; crea otra suscripción para rotar credenciales.

Las alertas operativas tienen bandeja dedicada por negocio y un registro de
intentos inmutable. Administradores configuran y recuperan ese canal en
Operaciones → Alertas externas; gerentes y administradores reconocen incidentes.
La evidencia de intentos dura 90 días y la historia resuelta, 365 días. Receptor
ausente o desactivado nunca se muestra como entrega exitosa, y un fallo de
entrega nunca elimina el incidente del producto.

La entrega externa es transporte de software hacia un receptor aprovisionado
por el comerciante. Puntovivo no proporciona centro de monitoreo atendido,
equipo de guardia, SLA ni tiempo de respuesta garantizado.
