# 0040 — Owner web push from the local server

**Language:** English · [Español](../es/architecture/0040-owner-web-push.md)

> Status: Accepted
> Date: 2026-11-22

## Context

The owner follows the store from the Companion on a phone. An approval waiting
at the till, a register handed over or the day sealed only showed up if the
Companion was open. The server is local-first: it may be offline, and it must
never wait on a phone to finish a sale, a handoff or a close.

## Decision

- Standard Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm message
  encryption (RFC 8291), implemented on `node:crypto` with no new dependency.
  The push service the browser picked relays ciphertext it cannot read; the
  encryption matches the RFC 8291 test vector.
- One VAPID key pair per installation, created on first use and stored in
  `app_settings` with the private half sealed (AES-256-GCM) under a key derived
  from the database key, which the desktop keeps in the OS keychain. Without a
  database key push is unavailable. A pair sealed under an earlier database key
  is replaced and its subscriptions dropped; browsers subscribe again.
- `push_subscriptions` (additive migration 0107) holds one row per browser
  endpoint, owned by one user, with the browser's keys sealed and bound to the
  endpoint. It is installation-local and never synced. Re-subscribing an
  endpoint moves it to the person who did it; each person keeps at most ten.
- Opt-in per person from the Companion, for admins and managers with the
  Companion module on. Signing out of the Companion drops this phone first.
- Three events: an approval request waits (people whose role can approve it),
  a register handoff is received, and the day is sealed (admins and managers).
  The person who acted is never told about their own action. Copy is rendered
  on the server in the language chosen at opt-in; customer names never travel.
- Delivery runs after the write commits, is fire-and-forget and never throws
  into the procedure. Endpoints must be public HTTPS hosts on the default port
  and are DNS-pinned per request, reusing the webhook destination policy. A
  404 or 410 removes the subscription. Nothing is queued or retried: a late
  approval or handoff notice is worse than none.

## Consequences

- An installation with internet access reaches the owner's phone through the
  browser vendor's push service; an offline one simply sends nothing.
- Requests created on another node and replicated by sync do not notify from
  the receiving node; the node that took the request sends it.
- The Companion service worker gains `push` and `notificationclick` handlers;
  a tap opens or focuses the Companion and never leaves its origin.
