# Guía de pruebas tRPC

**Idioma:** Español · [English](../TRPC_TESTING_GUIDE.md)

> Actualizado: 1 de junio de 2026

## Enfoque actual

La forma rápida y confiable de validar tRPC en este repositorio es:

1. Suites Vitest específicas del servidor con `appRouter.createCaller(...)`.
2. Pruebas Vitest web completas o específicas.
3. Build web de producción.
4. Comprobación de tipos de escritorio si cambia preload/main.

## Requisitos previos

### Versión de Node

Usa Node 24 o posterior, como exige la raíz del repositorio.

### Verificación nativa portable

Después de instalar, verifica el prebuild Node-API incluido; no lo recompiles:

```bash
pnpm --filter @puntovivo/desktop run native:ensure:electron
```

Para preparar el entorno actual de consola para pruebas del servidor:

```bash
pnpm --filter @puntovivo/server run native:ensure:node
```

## Comandos recomendados

### Suite específica del servidor

```bash
pnpm --filter @puntovivo/server run test -- sales --reporter=dot
pnpm --filter @puntovivo/server run test -- purchases --reporter=dot
pnpm --filter @puntovivo/server run test -- dashboard sync --reporter=dot
```

### Suite web completa

```bash
pnpm --filter @puntovivo/web run test -- --run
```

### Build web de producción

```bash
pnpm --filter @puntovivo/web run build
```

### Tipos de escritorio

```bash
pnpm --filter @puntovivo/desktop run typecheck
```

## Patrón preferido de prueba del servidor

Prefiere llamadas directas para reglas de negocio:

```ts
const caller = appRouter.createCaller(context);
const result = await caller.sales.summary();
```

Motivos:

- Más rápidas que pruebas HTTP.
- Control sencillo del contexto de negocio/usuario/sede.
- Mejor cobertura de reglas transaccionales.

## Comprobaciones manuales de solicitudes

### Salud compatible

```bash
curl http://localhost:8090/api/health
```

### Salud tRPC canónica

```bash
curl http://localhost:8090/api/trpc/health.check
```

### Ejemplo de acceso con fixture desechable explícito

Estas credenciales solo corresponden a un fixture propio desechable cargado
explícitamente. En una instalación interactiva usa la cuenta real del propietario;
consulta [LOGIN_GUIDE.md](../LOGIN_GUIDE.md). El servidor usa JSON simple, sin sobre de transformador.

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"email":"admin@localhost","password":"Admin123!Dev"}}'
```

### Comprobación del flujo de autenticación híbrida

```bash
# 1. Mint CSRF cookie
curl -i -c cookies.txt "http://localhost:8090/api/trpc/health.check"

# 2. Login and capture refresh cookie
curl -i -b cookies.txt -c cookies.txt \
  -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"email":"admin@localhost","password":"Admin123!Dev"}}'

# 3. Read the updated CSRF token from the jar after login; refresh and save rotated cookies
curl -i -b cookies.txt -c cookies.txt \
  -X POST "http://localhost:8090/api/trpc/auth.refresh?batch=1" \
  -H "x-csrf-token: <csrf-token-from-cookie-jar>" \
  -H "Content-Type: application/json" \
  -d '{"0":null}'
```

## Qué validar según el cambio

### Solo servidor

- Suite específica del servidor.
- Cualquier suite relacionada afectada directamente.

### Interfaz web

- Suite web específica o completa.
- Build web.

### Puente de escritorio

- Tipos de escritorio.
- Suite web afectada si cambió el contrato del renderer.
- Suite del servidor si cambió el backend integrado o la sincronización.

## Avisos conocidos de build

El build web todavía muestra avisos Vite de chunks grandes.
Trátalos como trabajo pendiente de rendimiento, no como fallo automático,
salvo que el build termine con error.
