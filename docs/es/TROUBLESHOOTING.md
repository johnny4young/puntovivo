# Solución de problemas

**Idioma:** Español · [English](../TROUBLESHOOTING.md)

> Actualizado: 27 de agosto de 2026

## 1. Un módulo nativo no carga

### Síntomas

- Falta el binario precompilado de `better-sqlite3` incluido en el paquete.
- `better-sqlite3` falla en Node o Electron.
- `argon2` falla al iniciar la aplicación de escritorio.

### Solución

```bash
pnpm --filter @puntovivo/desktop run native:ensure:electron
```

Verifica el mismo binario SQLite Node-API en Node independiente:

```bash
pnpm --filter @puntovivo/server run native:ensure:node
```

No ejecutes node-gyp ni electron-rebuild para better-sqlite3 v13. Si falla alguno
de los verificadores, restaura el paquete cuya integridad se comprueba mediante
`pnpm install --frozen-lockfile`. Recompilar para una máquina ocultaría una
instalación dañada y eliminaría la portabilidad entre entornos de ejecución.

## 2. La aplicación de escritorio abre con la interfaz vacía o dañada

### Comprobación

En desarrollo, es posible que el servidor de desarrollo del renderer no esté activo.

### Solución

```bash
pnpm run dev:desktop
```

También puedes iniciar los componentes manualmente:

```bash
pnpm run dev:web
pnpm run dev:desktop-shell
```

## 3. La aplicación web no llega al backend

### Comprobación

```bash
curl http://localhost:8090/api/health
```

### Solución

- Verifica que el servidor independiente esté activo con `pnpm run dev:server`.
- Verifica que `VITE_API_URL` coincida con el puerto del servidor.
- Reinicia el servidor de desarrollo web después de cambiar `apps/web/.env`.

## 4. Confusión sobre las solicitudes tRPC

La API canónica de la aplicación es `/api/trpc`; las rutas REST anteriores no
son la API principal.

Usa:

```bash
curl http://localhost:8090/api/trpc/health.check
```

`/api/health` es únicamente un endpoint de compatibilidad.

## 5. El puerto ya está ocupado

```bash
lsof -i :8090
lsof -i :3000
```

Detén el proceso que genera el conflicto o cambia el puerto configurado.

## 6. No aparecen los scripts de depuración de escritorio en la raíz

Los scripts de la raíz combinan los componentes de la aplicación.
Los scripts de depuración propios del escritorio están en su workspace:

```bash
pnpm --filter @puntovivo/desktop run dev:desktop:debug
pnpm --filter @puntovivo/desktop run dev:desktop:debug-brk
```

## 7. La compilación web muestra advertencias sobre chunks

Las advertencias de Vite sobre chunks grandes son conocidas y no significan
por sí solas que la compilación haya fallado. Trátalas como un asunto de
rendimiento pendiente, salvo que `vite build` termine con un código distinto de cero.

## 8. El inicio de sesión falla

Comprueba lo siguiente:

- Una instalación interactiva nueva crea a su primer propietario desde la pantalla de acceso; usa esa cuenta real.
- `admin@localhost` solo existe en un fixture cargado explícitamente; su contraseña inicial es `Admin123!Dev` o `PUNTOVIVO_DEV_ADMIN_PASSWORD` solo si al menos uno de `NODE_ENV` y `PUNTOVIVO_RUNTIME_ENV` está declarado y cada marcador declarado vale `development` o `test`; de lo contrario, la carga la genera.
- Las credenciales de prueba no recuperan acceso a una instalación existente.
- El negocio y el usuario están activos.

Consulta:
[LOGIN_GUIDE.md](./LOGIN_GUIDE.md)

## 9. El servidor independiente de producción no inicia sin una clave de base de datos

El servidor independiente con configuración de producción termina antes de
abrir SQLite si falta `PUNTOVIVO_DB_KEY` o su formato es incorrecto. Genera
exactamente 32 bytes aleatorios en hexadecimal y guarda el resultado en el
administrador de secretos del despliegue:

```bash
openssl rand -hex 32
```

Inyecta ese valor de 64 caracteres como `PUNTOVIVO_DB_KEY` y reinicia. No agregues
una excepción para usar texto plano, no imprimas la clave ni la guardes en `.env`
versionado. Si la base ya existe en texto plano, establecer una clave no la
convierte: conserva una copia verificada y ensaya una migración sin conexión
antes de reiniciar en producción. El servidor independiente no proporciona un
comando de conversión automática.

## 10. La sincronización parece desactualizada

Comprueba lo siguiente:

- Está seleccionado el negocio actual.
- Está seleccionada la sede actual cuando corresponda.
- La cola pendiente y los conflictos del centro de sincronización de la empresa.
- El estado sin conexión del navegador o de la aplicación de escritorio.

Si hace falta, usa el centro de sincronización de la página Empresa para:

- Descargar una instantánea nueva.
- Procesar la cola.
- Resolver conflictos.

## 11. Lista rápida de comprobación

```bash
node --version
pnpm install
pnpm --filter @puntovivo/desktop run native:ensure:electron
curl http://localhost:8090/api/health
pnpm --filter @puntovivo/web run test -- --run
```
