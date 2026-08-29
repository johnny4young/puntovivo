/** Explicit development launcher for the fail-closed standalone entry point. */
export {};

await import('./loadEnv.js');

const { markStandaloneDevelopmentRuntime } = await import('./config/standalone-database.js');
markStandaloneDevelopmentRuntime();

await import('./standalone.js');
