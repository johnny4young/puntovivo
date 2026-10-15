# Carga de datos de desarrollo desechables

**Idioma:** Español · [English](../DEV-SEED.md)

El comando explícito crea datos de demostración para desarrollo, pruebas y QA.
Los puntos de entrada interactivos de escritorio y servidor independiente usan
`seedData: false`; una instalación nueva crea a su primer propietario desde
la pantalla de acceso. Las cuentas de prueba no recuperan acceso en producción.

## Invocación

Ejecuta desde la raíz contra una base propia destinada a pruebas desechables:

```bash
# Default dataset
pnpm run seed:dev

# Larger catalog
SEED_PRESET=large pnpm run seed:dev

# Large catalog plus 90+ days of operational history
SEED_PRESET=mega pnpm run seed:dev

# Replace the demo tenant in the selected disposable database (destructive)
SEED_RESET=true pnpm run seed:dev

# Combine options
SEED_PRESET=large SEED_RESET=true pnpm run seed:dev
SEED_PRESET=mega SEED_RESET=true pnpm run seed:dev

# Country fixtures (default CO)
SEED_COUNTRY=MX pnpm run seed:dev
SEED_COUNTRY=CL pnpm run seed:dev

# Help and equivalent direct-workspace flags
pnpm --filter @puntovivo/server run seed:dev -- --help
pnpm --filter @puntovivo/server run seed:dev -- --preset=large --reset
```

Los presets admitidos son `default`, `large` y `mega`; los países son `CO`, `MX`
y `CL`. Las opciones CLI explícitas tienen prioridad sobre el entorno. Reset
elimina el negocio `demo-co` y sus registros de prueba dependientes antes de
recrearlos. La ruta no comprueba quién es propietario de los datos: nunca
apuntes el comando a un negocio real ni a la base de otra tarea.

## Destino y cifrado de la base

La CLI resuelve el archivo en este orden:

1. `DATABASE_URL`: la ruta explícita siempre tiene prioridad.
2. `SEED_TARGET=desktop`: calcula su ruta de usuario heredada para
   `@puntovivo/desktop`; no consulta una aplicación Electron en ejecución.
3. Valor predeterminado: `packages/server/data/local.db`.

Rutas calculadas por la opción heredada:

| Plataforma | Ruta de la CLI                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------- |
| macOS      | `~/Library/Application Support/@puntovivo/desktop/data/local.db`                                   |
| Linux      | `$XDG_CONFIG_HOME/@puntovivo/desktop/data/local.db` o `~/.config/@puntovivo/desktop/data/local.db` |
| Windows    | `%APPDATA%/@puntovivo/desktop/data/local.db`                                                       |

Estas rutas no determinan dónde están una instalación empaquetada ni la base
administrada por el lanzador de desarrollo. Prefiere una ruta desechable explícita.

Los lanzadores integrados `dev:desktop`, `dev:desktop-shell` y `dev:web-stack`
normalmente inyectan `DATABASE_URL=packages/server/data/shared.db` y una clave
privada `PUNTOVIVO_DB_KEY`. Guardan la clave generada en el archivo ignorado
`packages/server/data/shared-db-key.local`. La CLI no hereda automáticamente
cambios de entorno efectuados dentro de otro proceso lanzador.
Por tanto, `SEED_TARGET=desktop` no carga automáticamente la base compartida.

Para que la carga y el entorno de desarrollo lean el mismo fixture cifrado,
configura en ambos procesos la misma ruta explícita y la misma clave privada de
64 caracteres hexadecimales mediante su entorno. La CLI respeta la clave y
configura el ancla de auditoría correspondiente. No la imprimas ni la agregues
al repositorio. Cargar datos en texto plano y abrir después el archivo con otro
cifrado puede fallar con `SQLITE_NOTADB`; no convierte el archivo.

Después de configurar esa clave privada en ambos entornos, usa la ruta explícita:

```bash
DATABASE_URL=/absolute/path/to/owned-disposable.db pnpm run seed:dev
DATABASE_URL=/absolute/path/to/owned-disposable.db pnpm run dev:desktop
```

Detén la aplicación o el servidor propios que usen ese fixture antes de cargarlo
o restablecerlo. Para el servidor independiente también puedes fijar la ruta:

```bash
DATABASE_URL=/absolute/path/to/owned-disposable.db pnpm run dev:server
```

## Cuentas de prueba y aislamiento entre negocios

La CLI inicializa explícitamente el negocio de prueba base `default` y después
agrega `demo-co`. Las lecturas operativas usan el negocio del usuario
autenticado; ambos conjuntos de datos no se convierten en un solo negocio.

### Negocio de demostración

Las cuentas de demostración usan `Admin123!Dev`, con hash Argon2. La contraseña
fija está definida por `DEV_USER_PASSWORD`; no es una credencial de producción.

| Correo                  | Rol       | Nombre de prueba        |
| ----------------------- | --------- | ----------------------- |
| `admin@demo.co`         | `admin`   | Administrador Demo      |
| `manager.norte@demo.co` | `manager` | María Manager (Norte)   |
| `manager.sur@demo.co`   | `manager` | Mateo Manager (Sur)     |
| `cashier.norte@demo.co` | `cashier` | Carolina Cajera (Norte) |
| `cashier.sur@demo.co`   | `cashier` | Camilo Cajero (Sur)     |
| `viewer@demo.co`        | `viewer`  | Visor Demo              |

Usa el administrador para capturas con datos y configuración, y los demás roles
para comprobar permisos. La cuenta base `admin@localhost` pertenece al negocio
de prueba separado. Su contraseña inicial predeterminada es `Admin123!Dev` y
acepta `PUNTOVIVO_DEV_ADMIN_PASSWORD` solo si al menos uno de `NODE_ENV` y
`PUNTOVIVO_RUNTIME_ENV` está declarado y cada marcador declarado vale
`development` o `test`. Con marcadores ausentes o incompatibles genera una
contraseña; la CLI no declara automáticamente un marcador de desarrollo.
Esto no modifica la constante de demostración. Reemplazar el
negocio demo no restablece cuentas base ni sus datos operativos existentes.

Una prueba de primer propietario debe comenzar con una instalación aislada sin
propietario. Un fixture base que parece vacío ya tiene propietario y no equivale
a ese flujo. Consulta [LOGIN_GUIDE.md](./LOGIN_GUIDE.md).

## Cobertura de los conjuntos de datos

El catálogo ordinario usa nombres, SKU y precios estables. Los identificadores
generados, hashes de contraseñas y fechas relativas a la ejecución impiden
prometer que dos archivos de base sean idénticos byte a byte.

| Preset    | Cobertura                                                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` | 50 productos, dos sedes, seis usuarios demo, clientes, proveedores, categorías, unidades, existencias, plantillas de recibos y ejemplos operativos. |
| `large`   | 500 productos y las rutas ampliadas de catálogo e historial para probar búsquedas y listas.                                                         |
| `mega`    | La base del preset grande más 90 días o más de operaciones históricas y una pequeña pasada de ventas recientes mediante tRPC.                       |

Los fixtures incluyen empresa, geografía, catálogos fiscales/de identificación,
prefijos de numeración por sede, clientes, existencias, compras, cotizaciones,
sesiones de caja y plantillas. Prefijos como `VTA-N-` y `VTA-S-` evitan colisiones
entre secuencias de sedes sujetas a unicidad por negocio. El número real de
ventas completadas puede variar cuando se activan controles de existencias.

Mega agrega ventas, devoluciones, anulaciones, borradores, movimientos de caja
e inventario, compras y devoluciones a proveedor, transferencias, cotizaciones,
órdenes de compra, auditoría, cola/conflictos de sincronización, auditoría de IA,
intentos de acceso y un logo de ejemplo. Sus fechas son relativas a la ejecución,
no un período fijo del calendario. Los perfiles de país y fixtures fiscales
son datos de software; no demuestran transmisión ni certificación de una autoridad.

Los constructores canónicos son
[seed-dev.ts](../../packages/server/src/db/seed-dev.ts) y
[seed-mega/](../../packages/server/src/db/seed-mega/).

## Repetir y restablecer

Sin `SEED_RESET=true`, la existencia del negocio demo convierte el constructor
en una operación sin cambios; la CLI puede seguir mostrando las credenciales
de prueba. Con reset, elimina el demo y sus registros dependientes antes de
recrearlos. La idempotencia no autoriza a ejecutar contra una base desconocida.

Para un fixture completamente limpio, elige un archivo desechable propio nuevo
y carga los datos allí. No borres una base existente para obtener un estado
inicial ni recuperar una cuenta. Esta guía no proporciona un procedimiento de
borrado de datos de producción.

## Límite de producción

No ejecutes la CLI sobre datos de producción. Su control actual consulta
`PUNTOVIVO_RUNTIME_ENV` si no está vacío y, en caso contrario, `NODE_ENV`, y
rechaza el valor literal `production`. Eso no demuestra por sí solo que el
archivo seleccionado sea de desarrollo. No cambies marcadores de producción
para saltar un rechazo. Las pruebas aisladas también llaman directamente a
`seedDevData()`; quien la invoque debe proporcionar el límite de datos correcto.

## Solución de problemas

### Salida 137

El código 137 indica SIGKILL: 128 más la señal 9. No determina por qué se terminó
el proceso ni demuestra contención SQLite. Revisa el supervisor o timeout de
pruebas propietario, la presión de memoria del sistema y los logs disponibles.
Un error de base ocupada de SQLite es un diagnóstico distinto.

Inspecciona únicamente los procesos que usan el fixture elegido:

```bash
lsof /absolute/path/to/owned-disposable.db
```

Detén solo procesos propios mediante su cierre normal. No uses comandos de
terminación amplios sobre servidores de otros worktrees. Si otra aplicación es
propietaria del archivo, usa otro destino desechable.

### Colisiones de numeración

Los fixtures crean prefijos por sede. Si secuencias insertadas manualmente
colisionan, revisa la base elegida y la restricción que falla. No restablezcas
un negocio real para evitar un error de numeración.

### Datos inesperados en la cuenta base

El negocio base conserva la actividad previa de desarrollo. Restablecer el demo
no lo vacía. Elige otro archivo desechable para comparar una base limpia con el
demo poblado, en lugar de borrar el archivo anterior.

## Implementación y pruebas

- [CLI](../../packages/server/src/scripts/seed-dev.ts): opciones, destino y control de entorno.
- [Configuración de clave de auditoría](../../packages/server/src/scripts/seed-dev-security.ts): anclas para el mismo cifrado.
- [Pruebas del constructor](../../packages/server/src/__tests__/seed-dev.test.ts): datos, idempotencia, invariantes monetarias/de inventario y aislamiento.
- [Scripts del servidor](../../packages/server/package.json) y [scripts de la raíz](../../package.json).

```bash
pnpm --filter @puntovivo/server run test -- seed-dev
```

La suite usa datos aislados. No implica carga ni borrado en producción ni
aceptación de dispositivos físicos.
