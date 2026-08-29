/** Explicit production launcher for the fail-closed standalone entry point. */
export {};

await import('./loadEnv.js');

const { markStandaloneProductionRuntime } = await import('./config/standalone-database.js');
markStandaloneProductionRuntime();

await import('./standalone.js');
