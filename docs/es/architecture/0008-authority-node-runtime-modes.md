# 0008: modos de ejecución del nodo de autoridad

**Idioma:** Español · [English](../../architecture/0008-authority-node-runtime-modes.md)

> Estado: aceptada
> Fecha: 8 de mayo de 2026
> No sustituye otra; amplía ADR-0001 al tratar autoridad local como modo de ejecución, no solo regla por caja.

## Decisión

Puntovivo modela la verdad operativa mediante un **nodo de autoridad**:
el proceso que controla la escritura SQLite de una sede o caja individual.

El predeterminado sigue siendo `device_local`: una caja ejecuta Electron,
Fastify integrado en main, archivo SQLite local y bandejas de ese archivo.
El segundo modo soportado `site_hub` permite que una máquina controle SQLite
de sede mientras terminales `hub_client` envían comandos por LAN. Un
`hub_client` no es autoridad, no escribe tablas ni emite `sync_outbox` de la
venta pedida; lo hace el Hub tras aceptar el comando.

Los nombres son contratos estables:

```ts
type AuthorityMode = 'device_local' | 'site_hub' | 'hub_client';
```

Servidor central/nube sigue aguas abajo. Consume eventos/payloads del nodo
que fue autoritativo; no es requisito para vender localmente.

## Alternativas rechazadas

- **SQLite en disco de red/NAS:** la ruta POS requiere un proceso propietario;
  varios escritores por SMB/NFS agregan riesgo de corrupción y latencia.
- **Solo nube:** rompe venta sin Internet y añade conectividad a la ruta crítica.
- **Malla CRDT entre cajas:** excesiva para dinero, fiscalidad, caja e inventario,
  cuyos conflictos requieren política explícita y visibilidad.
- **Escritura satélite sin conexión en v1:** útil después, pero crea otro plano
  de sync terminal/Hub. El soporte actual rechaza operación si el Hub no está disponible.
- **Otra base de código antes del soporte local:** podría existir
  `puntovivo-store-hub`, pero primero reutiliza `@puntovivo/server`, migraciones,
  bandejas y servicios de aplicación existentes.

## Impacto de implementación

- Electron e independiente comparten resolver local. Controla `authorityMode`,
  `hubUrl`, `bindHost`, `bindPort`, `siteId`, `deviceId` y `allowedLanOrigins`.
- Conserva `device_local` sin configuración. Instalaciones existentes siguen
  iniciando en loopback sin asistente nuevo.
- Amplía registro de `kind: 'desktop' | 'web'` a metadatos de rol
  (`device_local`, `site_hub`, `hub_client`) sin romper filas existentes.
- `site_hub` solo escucha LAN con configuración explícita. Es dueño del archivo;
  las terminales no lo montan.
- `hub_client` apunta renderer/tRPC a `hubUrl` y muestra alcance del Hub antes de vender.
- Autenticación Electron `hub_client` cruza main/preload limitado. Main controla
  acceso remoto, par refresh/CSRF rotado, cambio de empleado y logout. Tráfico
  `/api/*` del renderer usa el mismo destino fijo y cabeceras permitidas, sin
  expandir CSP/CORS dinámicamente; solo recibe token corto. El sobre renovable
  se sella con llavero del SO y modo `0600` donde existe, o ACL por usuario en
  Windows. Empaquetados exigen HTTPS; HTTP loopback solo en desarrollo.
- Tiempo real comparte esa autoridad en vez de otra cookie. Navegador/local
  usan `fetch` con Authorization; `hub_client` usa relay main fijo a
  `/api/realtime/subscribe`. Ambas rutas comparten parser incremental, cursor,
  reconexión acotada y terminan si revalidar `sessionVersion` detecta revocación.
- Periféricos del `hub_client` ejecutan por puente físico local tras autorizar
  el Hub o devolver payload imprimible. Nunca escribe negocio ni se vuelve autoridad.
- El contexto crítico liga `deviceId`, `operationId`, `idempotencyKey`,
  `tenantId`, `siteId` y `actorId`. Negocio y actor proceden del contexto
  autenticado, no campos libres del sobre. El Hub guarda equipo llamador para
  auditoría, diario, bandejas y anomalías.
- Bandejas sync/fiscal/hardware/webhook pertenecen a la autoridad: caja en
  `device_local`, Hub de tienda en `site_hub`.
- Ingesta central debe consumir eventos/bandejas de autoridad, no tablas POS
  arbitrarias ni exigir que toda terminal sincronice independientemente.

## Mapa de implementación

- ADR del nodo y contrato de configuración.
- Endurecimiento del modo local predeterminado.
- Servidor Store Hub.
- Cliente Hub.
- Vinculación y salud de autoridad.
- Escrituras satélite sin conexión no admitidas; requieren alcance del Hub.

Actualizado: 22 de julio de 2026, tiempo real autenticado y revocable de Store Hub.
