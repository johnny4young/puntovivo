# External orders: local sandbox operation

## What this feature does

With the Delivery module enabled, managers and administrators can open **External
orders** in the receiving workspace. A received request does not create a sale,
reserve stock or collect payment. The generic signed contract is a sandbox seam,
not an integration certified for an aggregator or delivery provider.

## Configure a connector

1. Ensure the server has encrypted credential storage. Desktop uses its database
   key source. Standalone can supply a stable `PUNTOVIVO_EXTERNAL_ORDER_KEY` with
   64 hexadecimal characters representing 32 random bytes. Production still
   requires `PUNTOVIVO_DB_KEY`; these are separate requirements.
2. As an administrator, choose the target site and open **Connectors**.
3. Create a connector, generate its secure key and save that key in the sending
   system's private credential store. Acknowledge that it is saved before submitting.
4. Give the sender the connector ID and the signed tRPC endpoint. Do not include
   keys, addresses or customer data in screenshots or support messages.
5. Rotate explicitly when necessary: the old signing key stops working immediately.
   Disabling a connector stops signed ingress; it does not erase received orders.

Stored keys are never retrievable. Up to 100 connectors can be configured per site.
Preserve the wrapping key across server restarts. Changing it does not re-encrypt
old credentials; restore the original wrapping configuration or explicitly rotate
connector credentials before expecting the sender to authenticate again.

## Review, collect and cancel

Select a request and choose **Review local prices**. Every product code refers to
an active local base-unit SKU; fractional products require their normal quantity
policy. Unsupported items/currency/quantity policies fail closed. Compare the
source quote with local prices and confirm with the source before checking the
explicit consent box. **Accept and create draft** reserves stock and sends any
configured kitchen work but does not collect payment. An open authorized cash
session is required by the ordinary sale kernel.

Use **Open suspended sales**, select the draft labelled with the source order ID,
and resume it to collect payment. A completed linked sale exposes its details and
eligible delivery creation. Delivery creation does not collect a second payment.

A source cancellation after acceptance blocks checkout and fulfillment. Discard
an unpaid draft, or issue a full return from the linked paid sale before resolving
the request. No refund is automatic. The transition history distinguishes signed
source events from operator decisions. A cancellation that arrived before order
details remains cancelled even if those details later arrive.

## Exercise the signed sandbox

Create an ordinary UTF-8 event file with synthetic data, for example:

```json
{
  "schemaVersion": 1,
  "eventId": "sandbox-create-1",
  "orderId": "sandbox-order-1",
  "kind": "order.created",
  "order": {
    "customerName": "Sandbox customer",
    "address": "Sandbox address",
    "currencyCode": "COP",
    "quotedTotal": 12500,
    "items": [{ "productCode": "LOCAL-SKU", "quantity": 1 }]
  }
}
```

Save the one-time signing key in a private file (owner-only permissions on Unix).
Never pass the key value as a command-line argument. From the repository root:

```sh
pnpm --filter @puntovivo/server exec tsx src/scripts/simulate-external-order.ts \
  --origin http://127.0.0.1:8090 \
  --connector CONNECTOR_ID \
  --secret-file /absolute/private/key-file \
  --event-file /absolute/sandbox/create.json \
  --repeat 2
```

The repeat sends the exact envelope again. Add `--fresh-retry` to keep event bytes
and identity but regenerate timestamp/nonce/signature. Both must leave one request.
Only HTTP loopback or explicit HTTPS origins are accepted; redirects are rejected.
The tool logs attempt number, HTTP status and whether a valid receipt acknowledges
the submitted event/order identity. An arbitrary HTTP 200 is not success. It never
logs credentials, customer data or response bodies.

To cancel, send a separate event file:

```json
{
  "schemaVersion": 1,
  "eventId": "sandbox-cancel-1",
  "orderId": "sandbox-order-1",
  "kind": "order.cancelled",
  "reason": "Sandbox cancellation"
}
```

Send cancellation first to exercise out-of-order delivery. Reuse an event ID only
with exactly the same body; changing its payload is a conflict. A signed timestamp
is valid for five minutes. There is no automatic retry loop or source payment field.

## Operational limits

The authority is the local store database. Inbox and connector graphs are not
remotely applied through generic sync. Real vendor adapters, legal retention,
provider reconciliation, actual hardware and signed deployment qualification
require external validation. See [the architecture decision](./architecture/0023-signed-external-order-inbox.md).
