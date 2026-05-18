-- ENG-089 — per-customer credit limit (cupo de crédito).
--
-- Adds `credit_limit` to `customers` so the V5 "Cuenta corriente"
-- panel can render `Saldo proyectado: $X de un cupo de $Y` and
-- ENG-090 (credit sales) can gate `Cargar a cuenta` against the
-- limit via the planned `requireCreditLimitNotExceeded()` invariant.
--
-- Zero is the explicit "no limit" sentinel (`0 = sin cupo`) so reads
-- never have to special-case `NULL`. Existing rows backfill to 0,
-- preserving the pre-ENG-089 behavior where every customer has
-- unlimited credit by default.
--
-- `real` matches the precision of `customer_ledger_entries.amount` so
-- the cupo / saldo comparison math stays in one numeric domain. Zod
-- rejects negative values at the input layer; the DB does not enforce
-- a CHECK because SQLite ALTER TABLE cannot add CHECK constraints
-- inline (would require a table rebuild).

ALTER TABLE `customers` ADD COLUMN `credit_limit` real NOT NULL DEFAULT 0;
