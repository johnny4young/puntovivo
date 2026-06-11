/**
 * ENG-135b — ambient-environment isolation for the test suite.
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
