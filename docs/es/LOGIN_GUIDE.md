# Guía de inicio de sesión y acceso

**Idioma:** Español · [English](../LOGIN_GUIDE.md)

> Actualizado: 15 de octubre de 2026

## Modelo de autenticación

Puntovivo usa:

- Hash de contraseñas con Argon2.
- Tokens bearer de acceso en memoria.
- Cookies de renovación `httpOnly` con rotación.
- Protección CSRF en los flujos de autenticación respaldados por cookies.
- Controles de roles en rutas y procedimientos.
- Aislamiento entre negocios en el contexto del servidor.

La creación, el restablecimiento y el cambio de contraseña requieren:

- Al menos 12 caracteres.
- Al menos una mayúscula.
- Al menos una minúscula.
- Al menos un número.
- Al menos un carácter especial.

El transporte canónico de autenticación es tRPC en `/api/trpc`.

## Propietario durante el primer uso

Una instalación interactiva nueva comienza sin empresa ni administrador. La
pantalla de acceso ofrece dos pasos: empresa, sede, país y perfil; después,
nombre, correo y contraseña segura del propietario. Este inicia sesión mediante
el mismo flujo normal de autenticación que usan las cuentas existentes.

El selector de idioma está disponible antes de ambos pasos y en la pantalla de
acceso. Puedes elegir inglés, español o el idioma del equipo sin crear una
cuenta. La elección se conserva al cerrar sesión y reiniciar; cambiarla conserva
los valores ingresados y traduce los mensajes de validación.

- **Electron:** usa la ventana principal de Puntovivo. Su puente IPC limitado
  envía el comando fijo de configuración tRPC; el secreto de instalación nunca
  entra al renderer. Las ventanas auxiliares, los frames y los clientes Hub
  remotos no pueden apropiarse de una instalación.
- **Web independiente:** ejecuta el servidor y abre Puntovivo en ese mismo
  equipo. Ingresa el código privado de instalación de 64 caracteres que
  aparece al iniciar el servidor. La configuración mediante HTTP remoto se
  rechaza incluso con cabeceras reenviadas. Un túnel loopback administrado por
  el operador pertenece al despliegue administrativo; no es una función de
  registro remoto.
- Trata la salida de inicio que contiene ese código como una credencial.
  Restringe los logs de stdout del supervisor y nunca la envíes a telemetría,
  capturas o soporte. Un reinicio reemplaza un código sin usar; completar la
  creación del propietario lo consume.
- Las bases existentes se adoptan como instalaciones con propietario, sin
  cambiar cuentas, contraseñas ni datos. Eliminar o desactivar al propietario
  no vuelve a abrir la configuración. Si falta el marcador de finalización,
  el sistema rechaza la operación.
- Si la creación se confirmó pero se perdió la respuesta, inicia sesión con la
  cuenta elegida. No borres la base del negocio para recuperar una contraseña.
  Recurre a un administrador autorizado existente; si no lo hay, contacta al
  operador de la instalación en lugar de recrear la base.

Crear al propietario **no** deja al negocio listo para operar. Los datos
legales, tasas válidas, numeración, productos, empleados y configuración de caja
siguen siendo pasos explícitos. El país solo aporta moneda y configuración
regional del catálogo; no inventa deudas, existencias, identificadores fiscales
ni autorizaciones regulatorias.

### Fixtures de desarrollo explícitos

El tooling de carga y las plantillas de pruebas automatizadas pueden crear
`admin@localhost`. Su contraseña inicial predeterminada es `Admin123!Dev`,
configurable antes de cargar los datos con `PUNTOVIVO_DEV_ADMIN_PASSWORD`, solo
si al menos uno de `NODE_ENV` y `PUNTOVIVO_RUNTIME_ENV` está declarado y cada
marcador declarado vale `development` o `test`. De lo contrario, la carga genera
una contraseña.
Los puntos de entrada interactivos de escritorio y web independiente nunca
activan ese fixture automáticamente. Consulta [DEV-SEED.md](./DEV-SEED.md) para
crear datos desechables de demostración, no para recuperar acceso en producción.

## Roles

Roles actuales:

- `admin`
- `manager`
- `cashier`
- `viewer`

Rutas predeterminadas:

- `cashier` comienza en `/sales`.
- Los demás comienzan en `/dashboard`.

Código fuente:
[roleAccess.ts](../../apps/web/src/features/auth/roleAccess.ts)

## Flujo de autenticación

1. El usuario envía sus credenciales desde la pantalla de acceso.
2. La aplicación llama a `auth.login`.
3. El servidor valida usuario, negocio y hash de la contraseña.
4. El servidor devuelve un token de acceso de corta duración, información básica
   del usuario y del negocio, y establece una cookie de renovación.
5. El cliente mantiene el token de acceso en memoria y lo renueva cuando hace
   falta mediante la cookie de renovación.
6. Las rutas protegidas y los procedimientos tRPC controlan roles y acceso al negocio.

## Cambio de contraseña por el usuario

- Abre el menú de usuario del encabezado.
- Elige `Change password` (Cambiar contraseña).
- Envía tu contraseña actual y una nueva que cumpla la política de seguridad.
- Tras el cambio, la aplicación cierra la sesión y los tokens anteriores dejan de funcionar.

## Administración de contraseñas

- Los administradores deben aplicar la misma política segura al crear usuarios.
- Los restablecimientos administrativos también deben cumplirla.
- Si un administrador restablece su propia contraseña desde Usuarios, la
  aplicación cierra su sesión inmediatamente.

## Procedimientos de autenticación actuales

- `auth.login`
- `auth.logout`
- `auth.refresh`
- `auth.me`
- `auth.changePassword`

Código fuente:
[Router de autenticación](../../packages/server/src/trpc/routers/auth/index.ts)

## Ejecutar la aplicación

### Escritorio

```bash
pnpm install --frozen-lockfile
pnpm --filter @puntovivo/desktop run native:ensure:electron
pnpm run dev:desktop
```

### Web con backend independiente

```bash
pnpm run dev:web-stack
```

## Problemas habituales

### Credenciales inválidas

Comprueba lo siguiente:

- Usas la cuenta real del propietario; `admin@localhost` solo corresponde a un
  fixture de desarrollo cargado explícitamente.
- La contraseña es la elegida durante la configuración inicial.
- `Admin123!Dev` solo corresponde a fixtures de desarrollo explícitos y desechables.
- La cuenta del usuario está activa.

### No se puede conectar con el servidor

Comprueba:

```bash
curl http://localhost:8090/api/health
```

### Diferencias de módulos nativos en escritorio

Verifica el entorno nativo portable de Electron; no lo recompiles:

```bash
pnpm --filter @puntovivo/desktop run native:ensure:electron
```

Si después fallan pruebas del servidor por diferencias de `better-sqlite3` en
el entorno de la consola actual:

```bash
pnpm --filter @puntovivo/server run native:ensure:node
```

## Ejemplo de acceso con un fixture de desarrollo explícito

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"email":"admin@localhost","password":"Admin123!Dev"}}'
```

## Notas

- `auth.logout` invalida tokens de acceso y renovación anteriores al incrementar
  `sessionVersion` del usuario, revoca las familias de renovación y elimina las
  cookies de renovación/CSRF; el cliente o el proceso principal de Electron
  también elimina su custodia local de sesión.
- Los cambios de contraseña y restablecimientos administrativos invalidan
  sesiones anteriores mediante el versionado de sesión por usuario.
- Los tokens también se revocan cuando cambia `email` o `role` del usuario
  conectado o cuando se desactiva el negocio.
- Los flujos por sede también dependen de `x-site-id` después de seleccionar una sede.

## Sesiones renovables de escritorio

El renderer empaquetado usa un origen personalizado, mientras la autoridad
integrada sirve HTTP en el equipo local. Por eso, las cookies Strict de
renovación permanecen en el proceso principal de Electron y no dependen de que
el navegador entregue cookies entre sitios. La sesión integrada conserva las
credenciales de renovación y CSRF solo en memoria del proceso; al salir de la
aplicación termina esa custodia. El cliente Hub mantiene su sobre de credenciales
cifrado por el sistema operativo. Solo los tokens de acceso de corta duración
cruzan el puente preload.

El acceso local, la renovación, el cambio de empleado y el logout llaman a los
mismos procedimientos tRPC fijos mediante los controles normales de
autenticación, CSRF y límites de solicitudes del servidor integrado. El puente
no expone un proxy HTTP local de uso general. No cambian los tiempos de vida de
tokens, comprobaciones de revocación, controles de negocio/sede ni verificación
de sesión nativa. Una interrupción transitoria de la autoridad sigue siendo
un estado de recuperación; los cambios explícitos de cuenta y la revocación
confirmada eliminan la custodia renovable.
