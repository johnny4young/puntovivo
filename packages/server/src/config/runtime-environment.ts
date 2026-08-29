/** True only when every declared runtime marker explicitly opts into development/test. */
export function isExplicitDevelopmentOrTestRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  const declaredEnvironments = [env.NODE_ENV, env.PUNTOVIVO_RUNTIME_ENV].filter(
    (value): value is string => value !== undefined
  );
  return (
    declaredEnvironments.length > 0 &&
    declaredEnvironments.every(value => value === 'development' || value === 'test')
  );
}
