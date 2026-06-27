# tRPC Implementation Plan Notes

> Updated: April 9, 2026
> Status: historical plan, not the active backlog

This document is retained as a migration note.
The implementation plan it described is effectively complete for the current app surface.

## Completed Outcomes

- `/api/trpc` is the primary application API
- the web app uses the tRPC React client directly
- shared vanilla client support exists for non-hook usage
- domain routers cover the live product surface
- role, tenant, and auth logic are applied in middleware

## What Replaced the Old Plan

The active questions are no longer “how do we migrate to tRPC?”
They are now things like:

- how to harden sync behavior
- how to expand deeper workflows such as returns and site-aware stock
- how to reduce bundle size and operational risk

These are tracked internally.

## Current Recommended Reading Order

1. [TRPC_ARCHITECTURE.md](./TRPC_ARCHITECTURE.md)
2. [TRPC_TESTING_GUIDE.md](./TRPC_TESTING_GUIDE.md)
