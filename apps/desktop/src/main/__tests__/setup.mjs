// Node's built-in test runner imports production modules directly, so their
// shared Pino logger can emit operational records while exercising the main
// process. Keep warnings/errors visible; expected negative paths use injected
// test loggers or production control-flow classification.
process.env.NODE_ENV = 'test';
process.env.PUNTOVIVO_LOG_LEVEL = 'warn';
process.env.PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER = 'true';
