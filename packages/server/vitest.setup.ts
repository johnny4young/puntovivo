/**
 * ambient-environment isolation for the test suite.
 *
 * Every server test that boots `createServer()` (most of the suite)
 * runs the telemetry adapter init, which reads PUNTOVIVO_SENTRY_DSN
 * from the process environment. A developer shell that exports the
 * DSN for a local smoke would otherwise activate the REAL
 * @sentry/node SDK across ~180 test files and spray test exceptions
 * at a live project. Tests that exercise the adapter inject their
 * env explicitly via `initServerTelemetryAdapter({ env })`, so
 * stripping the ambient vars here changes nothing for them.
 */
delete process.env.PUNTOVIVO_SENTRY_DSN;
delete process.env.PUNTOVIVO_SENTRY_TRACES_SAMPLE_RATE;

/**
 * The server suite deliberately exercises rejected commands, authorization
 * failures, idempotency conflicts, and observability capture paths. Those
 * expected outcomes must remain assertions, not thousands of level-40/50
 * records that make a genuinely unexpected CI failure indistinguishable from
 * routine negative-path coverage.
 *
 * Keep warning/error records visible so an unexpected operational signal can
 * never disappear behind the test harness. Expected negative-path control flow
 * is classified below the warning floor by production code and remains covered
 * by direct assertions.
 */
process.env.PUNTOVIVO_LOG_LEVEL = 'warn';
process.env.PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER = 'true';
