# Webhooks

Puntovivo can deliver a small, versioned set of business events and
privacy-bounded operational alert transitions to an HTTPS endpoint owned by
the merchant. This is outbound delivery, not a general REST API: Puntovivo
continues to use tRPC for its application transport.

## Availability and safety

- An administrator must enable the optional Events API module and create a
  subscription for a fixed HTTPS URL.
- Production subscription creation requires the stable database encryption
  key. Signing secrets are sealed with AES-256-GCM and shown only once.
- Puntovivo resolves the destination when it is saved and again before every
  attempt. Loopback, private, link-local, reserved, `.local`, credentialed,
  non-HTTPS, custom-port, fragment, and redirect destinations are rejected.
- Payloads and secrets are not written to delivery logs. Operators see event
  identifiers, status, attempt count, HTTP status, error code, and timestamps.

## Envelope

Contract version: **1**

```json
{
  "id": "webhook_outbox_id",
  "type": "sale.completed",
  "version": 1,
  "occurredAt": "2026-08-01T14:30:00.000Z",
  "data": {}
}
```

Every POST includes:

| Header                   | Meaning                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `Idempotency-Key`        | Stable delivery identity; store it before applying an event.              |
| `X-Puntovivo-Event-Id`   | Stable event identifier.                                                  |
| `X-Puntovivo-Event-Type` | Event type from the manifest below.                                       |
| `X-Puntovivo-Timestamp`  | ISO 8601 signing timestamp.                                               |
| `X-Puntovivo-Signature`  | `v1=` plus the lowercase HMAC-SHA256 digest.                              |

The signed bytes are exactly `timestamp + "." + rawRequestBody`. Verify the
signature against the raw body before parsing JSON, compare in constant time,
reject stale timestamps according to your clock policy, and deduplicate using
the idempotency key.

Business-event deliveries use `eventId:subscriptionId` as their idempotency
key. Operational alert transitions use the dedicated alert-delivery ID because
each delivery row already belongs to one subscription. In both cases the value
is stable across every retry of that delivery.

## Event schema

The server-owned Zod manifest in
`packages/server/src/services/events/manifest.ts` is the source of truth. The
documentation contract test prevents this list from drifting.

### `sale.completed`

Required: `saleId`, `saleNumber`, `siteId`, `cashSessionId`, `customerId`
(nullable), `subtotal`, `taxAmount`, `discountAmount`, `total`, `currencyCode`,
`paymentMethod`, `completedAt`.

### `sale.refunded`

Required: `saleReturnId`, `originalSaleId`, `siteId`, `cashSessionId`,
`refundedAmount`, `currencyCode`, `reasonCode` (nullable), `refundedAt`.

### `inventory.adjusted`

Required: `productId`, `siteId`, `locationId` (nullable), `quantityBefore`,
`quantityAfter`, `delta`, `reasonCode` (nullable), `adjustedByUserId`,
`adjustedAt`.

### `cash_session.closed`

Required: `cashSessionId`, `siteId`, `cashierId`, `openedAt`, `closedAt`,
`expectedCashBalance`, `countedCashBalance`, `overShortAmount`, `currencyCode`.

### `fiscal_document.accepted`

Required: `fiscalDocumentId`, `cufe`, `documentNumber`, `source`, `sourceId`,
`countryCode`, `providerId`, `acceptedAt`.

### Operational alert transitions

- `operational_alert.opened`
- `operational_alert.escalated`
- `operational_alert.acknowledged`
- `operational_alert.resolved`

Each transition carries only `alertId`, `area`, `severity`, `status`, `count`,
`recoveryPath`, and `occurredAt`. It does not contain customer records, sale
lines, credentials, destination addresses, or provider response bodies.
Acknowledgement records that an operator has reviewed the incident; it never
suppresses the underlying Operations signal. A resolved incident that later
recurs receives a new alert identity.

## Verification examples

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

### Local receiver with curl

Use curl only to exercise your receiver; Puntovivo itself sends the signed
request. Preserve the raw bytes in the receiver:

```bash
curl --request POST https://your-domain.example/puntovivo \
  --header 'content-type: application/json' \
  --data-binary @fixture.json
```

## Delivery, retries, and recovery

Puntovivo treats 2xx as delivered. HTTP 408, 429, 5xx, network failures, and
timeouts retry after approximately 30 seconds, 2 minutes, 10 minutes, 1 hour,
and 6 hours. The sixth failed attempt becomes a dead letter. Other 4xx
responses and destination-policy failures dead-letter immediately.

Already delivered subscription/event pairs are never sent again while another
subscriber retries. `events.listDeliveries` uses `limit` (1–200) and `offset`
(0–10,000), ordered newest first. An administrator can retry a dead letter,
disable a subscription, or revoke it. Revocation destroys the sealed signing
secret and cannot be undone; create a new subscription to rotate credentials.

Operational alerts use a dedicated tenant-scoped delivery outbox and immutable
attempt ledger. Administrators configure and recover that channel under
Operations → External alerts; managers and administrators can acknowledge an
incident. Attempt evidence is retained for 90 days and resolved alert history
for 365 days. A missing or disabled receiver never appears as a successful
delivery, and delivery failure never removes the in-product incident.

External alert delivery is a software transport to a receiver the merchant
provisions. Puntovivo does not provide a staffed monitoring center, an on-call
response team, an SLA, or a guaranteed response time.
