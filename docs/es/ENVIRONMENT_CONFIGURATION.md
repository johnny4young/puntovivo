# Configuración del entorno

**Idioma:** Español · [English](../ENVIRONMENT_CONFIGURATION.md)

> Actualizado: 27 de agosto de 2026

## Descripción general

Puntovivo lee la configuración de dos lugares:

- `.env` en la raíz para el servidor y el entorno de escritorio.
- `apps/web/.env` para los ajustes web que Vite incorpora a la compilación.

Los ejemplos están en:

- [.env.example](../../.env.example)
- [apps/web/.env.example](../../apps/web/.env.example)

## Variables de entorno de la raíz

Estas variables afectan al servidor Fastify, al entorno de escritorio integrado o a ambos.

### Entorno del servidor

| Variable                           | Valor predeterminado                                                                                        | Propósito                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUNTOVIVO_AUTHORITY_MODE`         | `device_local`                                                                                              | Modo del nodo de autoridad según ADR-0008: `device_local`, `site_hub` o `hub_client`. Un valor inválido impide el inicio.                                                                                                                                                                                                                                                                                                         |
| `PUNTOVIVO_BIND_HOST`              | `127.0.0.1`                                                                                                 | Host de escucha del servidor Fastify integrado. Tiene prioridad sobre `HOST`.                                                                                                                                                                                                                                                                                                                                                     |
| `PUNTOVIVO_BIND_PORT`              | `8090`                                                                                                      | Puerto de escucha del servidor Fastify integrado. Tiene prioridad sobre `PORT`.                                                                                                                                                                                                                                                                                                                                                   |
| `PUNTOVIVO_HUB_URL`                | Sin definir                                                                                                 | URL obligatoria del hub cuando `PUNTOVIVO_AUTHORITY_MODE=hub_client`. El proceso principal de Electron conserva la autenticación renovable y solo reenvía solicitudes `/api/*` a este destino fijo. Los clientes empaquetados requieren HTTPS; en desarrollo se acepta HTTP únicamente para `localhost`, `127.0.0.1` o `::1`. Una URL ausente, inválida, con credenciales o una URL LAN insegura impide el inicio del escritorio. |
| `PUNTOVIVO_SITE_ID`                | Sin definir                                                                                                 | Identificador de sede proporcionado por el operador; si es null, se consulta la base de datos.                                                                                                                                                                                                                                                                                                                                    |
| `PUNTOVIVO_DEVICE_ID`              | Sin definir                                                                                                 | Identificador de dispositivo proporcionado por el operador; si es null, se usa `device-id.txt`.                                                                                                                                                                                                                                                                                                                                   |
| `PUNTOVIVO_ALLOWED_LAN_ORIGINS`    | Sin definir                                                                                                 | Orígenes CORS separados por comas aceptados en modo `site_hub`. El servidor Store Hub requiere al menos un origen explícito para iniciar.                                                                                                                                                                                                                                                                                         |
| `PORT`                             | `8090`                                                                                                      | Alias anterior de `PUNTOVIVO_BIND_PORT`. Se respeta si la variable nueva no está definida para mantener compatibles los despliegues independientes existentes.                                                                                                                                                                                                                                                                    |
| `HOST`                             | `127.0.0.1`                                                                                                 | Alias anterior de `PUNTOVIVO_BIND_HOST`. Tiene la misma compatibilidad descrita para `PORT`.                                                                                                                                                                                                                                                                                                                                      |
| `DATABASE_URL`                     | Valor interno predeterminado                                                                                | Ruta de la base SQLite en modo independiente.                                                                                                                                                                                                                                                                                                                                                                                     |
| `PUNTOVIVO_DB_KEY`                 | Sin definir en desarrollo/pruebas; **obligatoria en los demás casos**                                       | Clave SQLCipher del servidor independiente: exactamente 64 caracteres hexadecimales, equivalentes a 32 bytes. En un entorno de producción, el inicio falla antes de abrir SQLite si falta la clave o tiene formato inválido. Guárdala en el administrador de secretos del despliegue; nunca la agregues al repositorio ni a logs. Genérala con `openssl rand -hex 32`.                                                            |
| `PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS` | `5000`                                                                                                      | Ajuste opcional del tiempo de espera por el bloqueo de escritura de SQLite. Úsalo solo en pruebas o desarrollo con alta contención que compartan intencionalmente una base local.                                                                                                                                                                                                                                                 |
| `JWT_SECRET`                       | Se genera durante la ejecución en `device_local`; **se requiere un secreto fuerte explícito** en `site_hub` | Secreto para firmar JWT. Store Hub requiere un valor explícito de al menos 32 caracteres, con al menos 8 caracteres únicos y que no sea un marcador de ejemplo. Los secretos débiles o generados automáticamente pueden invalidar las sesiones de cajeros o debilitar los tokens LAN. Consulta [`ARCHITECTURE.md`](ARCHITECTURE.md#sincronización-y-nodo-de-autoridad).                                                           |
| `VERBOSE`                          | `false`, salvo que se active explícitamente                                                                 | Registro de mensajes del servidor.                                                                                                                                                                                                                                                                                                                                                                                                |

El servidor independiente lee estas variables mediante el resolutor compartido de
[config/runtime.ts](../../packages/server/src/config/runtime.ts)
y los puntos de inicio en
[standalone-development.ts](../../packages/server/src/standalone-development.ts),
[standalone-production.ts](../../packages/server/src/standalone-production.ts),
[standalone.ts](../../packages/server/src/standalone.ts) y
[apps/desktop/src/main/index.ts](../../apps/desktop/src/main/index.ts).

### Entorno de escritorio / Electron

| Variable             | Valor predeterminado                         | Propósito                                             |
| -------------------- | -------------------------------------------- | ----------------------------------------------------- |
| `WEB_DEV_SERVER_URL` | `http://localhost:3000`                      | URL del renderer durante el desarrollo de escritorio. |
| `AUTO_UPDATE`        | Activado, salvo que se establezca en `false` | Activa el actualizador automático del escritorio.     |

El actualizador empaquetado consulta cada hora mediante una cadencia interna
fija. El porcentaje de despliegue gradual y el destino provienen de
`https://johnny4young.github.io/puntovivo/update-policy.json`, que no contiene
credenciales. Son controles del release, no variables de entorno del equipo.
El workflow solo promueve releases normales mediante despliegue gradual. Un
límite mínimo monotónico sellado con `safeStorage` impide que ese origen mutable
autorice una versión anterior; para una reversión de emergencia se entrega un
instalador manual por separado.

Archivos relacionados:

- [index.ts](../../apps/desktop/src/main/index.ts)
- [auto-updater.ts](../../apps/desktop/src/main/auto-updater.ts)

## Variables de entorno web

Vite incorpora estas variables a la compilación y deben usar el prefijo `VITE_*`.

| Variable              | Valor predeterminado    | Propósito                                                                                                |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`        | `http://localhost:8090` | URL base del servidor utilizada por el cliente tRPC.                                                     |
| `VITE_ENABLE_OFFLINE` | `true`                  | Valor de ejemplo heredado; el código web actual no lo lee y no controla la operación sin conexión.       |
| `VITE_SYNC_INTERVAL`  | `30000`                 | Valor de ejemplo heredado; el código web actual no lo lee y no configura el intervalo de sincronización. |
| `VITE_APP_NAME`       | `Puntovivo`             | Valor de ejemplo heredado; el código web actual no lo lee y no cambia el nombre visible.                 |

Archivo relacionado:
[trpc.ts](../../apps/web/src/lib/trpc.ts)

## Configuraciones habituales

### Desarrollo local de escritorio

```bash
pnpm install --frozen-lockfile
pnpm --filter @puntovivo/desktop run rebuild
pnpm run dev:desktop
```

### Web local con servidor independiente

```bash
pnpm run dev:web-stack
```

### Puerto personalizado del backend

```bash
# root .env
PORT=9000

# apps/web/.env
VITE_API_URL=http://localhost:9000
```

## Comportamientos importantes

### Las variables de Vite se resuelven al compilar

Cambiar `apps/web/.env` requiere reiniciar el servidor de desarrollo web o
volver a compilar el bundle web.

### Las variables del servidor se resuelven durante la ejecución

Cambiar las variables de la raíz o del servidor solo requiere reiniciar el
proceso correspondiente.

### El cifrado de la base independiente rechaza configuraciones inseguras

El proceso independiente permite una base en archivo sin clave únicamente si
todos los marcadores de entorno declarados son explícitamente `development`
o `test`. Un entorno sin definir se trata como producción y se rechaza si no
hay clave. El comando `dev` del paquete establece desarrollo si el entorno no
estaba definido; `start` establece producción. Ninguno de los lanzadores
reemplaza un marcador proporcionado por el operador. Cualquier otro valor,
incluidos `production`, `staging`, uno desconocido o un conflicto donde algún
marcador indique producción, requiere un `PUNTOVIVO_DB_KEY` válido.

Si falta la clave, el proceso termina antes de abrir SQLite con este mensaje:

```text
PUNTOVIVO_DB_KEY is required for standalone startup outside development/test. Set a 64-character hexadecimal SQLCipher key; refusing to create or open a cleartext production database.
```

Las claves con formato inválido también se rechazan antes de conectar a la base.
El entorno no genera, reduce la protección ni reemplaza silenciosamente una
clave de producción. Guárdala en el administrador de secretos del despliegue y
respáldala por separado de la base cifrada. Establecer una clave no convierte
silenciosamente una base independiente existente en texto plano. No hay
conversión automática para el servidor independiente: realiza y ensaya una
migración sin conexión sobre una copia verificada antes de pasar el despliegue
a producción.

### El modo de escritorio mantiene Fastify integrado

En escritorio, el backend se ejecuta dentro del proceso principal de Electron.
El bundle web sigue necesitando el `VITE_API_URL` correcto durante el desarrollo
y la compilación del renderer.

## Verificación

```bash
curl http://localhost:8090/api/health
curl http://localhost:8090/api/trpc/health.check
```

Si cambiaste los puertos, ajusta la URL.
