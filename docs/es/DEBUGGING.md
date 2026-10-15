# Guía de depuración

**Idioma:** Español · [English](../DEBUGGING.md)

> Actualizado: 1 de junio de 2026

## Inicio rápido

### Aplicación de escritorio completa

```bash
pnpm run dev:desktop
```

### Solo web

```bash
pnpm run dev:web
```

### Solo backend independiente

```bash
pnpm run dev:server
```

## Scripts de depuración de escritorio

Los scripts específicos se exponen desde el workspace de escritorio, no desde la raíz:

```bash
pnpm --filter @puntovivo/desktop run dev:desktop:debug
pnpm --filter @puntovivo/desktop run dev:desktop:debug-brk
```

Inician Electron con el inspector de Node habilitado para el proceso principal.

## Dónde depurar cada problema

### Proceso principal de Electron

Úsalo para depurar:

- Inicio del servidor integrado.
- Handlers IPC.
- Respaldo y restauración.
- Bandeja del sistema.
- Impresión.
- Actualización automática.

Archivos relacionados:

- [index.ts](../../apps/desktop/src/main/index.ts)
- [auto-updater.ts](../../apps/desktop/src/main/auto-updater.ts)

### Puente preload

Úsalo para depurar:

- `window.electron`
- `window.sync`
- `window.session`
- Integración del renderer específica de escritorio.

Archivo relacionado:
[index.ts](../../apps/desktop/src/preload/index.ts)

### Renderer web

Úsalo para depurar:

- Controles de rutas.
- Uso de TanStack Query y tRPC.
- Módulos funcionales.
- Diseño y mensajes de la interfaz.

Archivos relacionados:

- [main.tsx](../../apps/web/src/main.tsx)
- [App.tsx](../../apps/web/src/App.tsx)

### Servidor

Úsalo para depurar:

- Middleware de autenticación y roles.
- Transacciones de base de datos.
- Sincronización.
- Informes.
- Validación de routers y reglas de negocio.

## Flujo práctico

### Depurar un problema del renderer

1. Ejecuta `pnpm run dev:web`.
2. Abre las herramientas de desarrollo del navegador.
3. Revisa solicitudes a `/api/trpc`.
4. Verifica invalidaciones de consultas y controles de rutas.

### Depurar el puente de escritorio

1. Ejecuta `pnpm --filter @puntovivo/desktop run dev:desktop:debug`.
2. Agrega puntos de interrupción en main o preload de Electron.
3. Activa la acción desde la aplicación de escritorio.

### Depurar una regla de negocio del servidor

1. Reproduce el problema con una suite Vitest específica.
2. Si hace falta, agrega logs temporales mediante `VERBOSE=true`.
3. Revisa el router afectado y los límites de la transacción.

## Comandos útiles

```bash
pnpm --filter @puntovivo/server run test -- sales --reporter=dot
pnpm --filter @puntovivo/web run test -- --run
pnpm --filter @puntovivo/desktop run typecheck
```

## Motivos habituales de confusión

- Olvidar que Fastify se ejecuta dentro del proceso principal de Electron en escritorio.
- Esperar funciones nuevas mediante REST en lugar de tRPC.
- Cambiar `apps/web/.env` sin reiniciar o recompilar la aplicación web.
- Tratar un fallo de módulo nativo como un cambio de ABI, en lugar de verificar el prebuild Node-API portable incluido para el entorno activo.
