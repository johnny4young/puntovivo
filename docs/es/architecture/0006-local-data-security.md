# 0006: seguridad local, recuperación y límites de datos de tarjeta

**Idioma:** Español · [English](../../architecture/0006-local-data-security.md)

> Estado: aceptada
> Decisión inicial: 7 de mayo de 2026
> Implementación actual revisada: 15 de octubre de 2026
> Predecesoras: ADR-0001 a ADR-0005

## Modelo de amenazas

La base operativa `${userData}/data/local.db` y la identidad
`${userData}/device-id.txt` pertenecen al nodo de autoridad local. La protección
cubre copia de disco/respaldo, límites de rol y exportaciones de soporte;
no afirma vencer a un atacante que ya tiene la clave de la instalación activa.

| Actor                                              | Límite de acceso                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Cajero autenticado                                 | Proyecciones tRPC autorizadas de negocio/rol; sin diagnósticos administrativos ni claves de base/respaldo.                        |
| Cuenta privilegiada del SO                         | Archivos, proceso y llavero dependen de privilegios del SO; SQLCipher no protege después de obtener la clave.                     |
| Lector de archivos o exempleado con copia de disco | Bytes cifrados; identidad/metadatos del manifiesto pueden verse en texto plano. Descifrar filas exige custodia de clave separada. |
| Servicio de soporte que recibe diagnósticos        | Solo proyecciones saneadas, no la base ni garantía de anonimato de contenido libre.                                               |

El almacenamiento empaquetado usa SQLCipher y almacenamiento seguro Electron.
Independiente con configuración de producción requiere la clave cruda de
32 bytes mediante `PUNTOVIVO_DB_KEY`; rechaza ausencia o formato inválido antes
de abrir SQLite. Solo desarrollo/prueba explícito admite archivo sin clave.
Importar texto plano heredado es una transición de actualización, no producción silenciosa.

## Respaldo e integridad

El ZIP contiene `local.db`, `device-id.txt` y `manifest.json`. La base es una
instantánea atómica: texto plano heredado usa la API de backup en línea;
SQLCipher usa `VACUUM INTO` con clave para mantener staging cifrado bajo la
clave de origen. WAL/SHM no se transportan.

Staging debe pasar `PRAGMA integrity_check` con clave y resultado `ok` antes
de publicar. El manifiesto v2 lleva hashes y MAC de clave de instalación;
una contraseña opcional envuelve la clave de respaldo sin volver la base texto
plano. Manifiesto/identidad son metadatos que el ZIP no necesariamente cifra.
Consulta [Seguridad](../../SECURITY.md).

Instantáneas manuales detienen/reinician Fastify mediante `runWithServerRestart`.
Las programadas se serializan por la cola de backup y usan instantáneas seguras
ante escrituras concurrentes sin detener servidor. Creación/extracción usa
archivos privados y buffers acotados. Cancelación o fallo cierra streams propios
antes de borrar temporales; nunca publica una salida parcial como respaldo correcto.

## Restauración e identidad

`detectBackupFormat` reconoce ZIP `50 4b 03 04`, SQLite crudo heredado
`53 51 4c 69` o rechaza formato desconocido. Un archivo SQLCipher crudo cifrado
no expone magic SQLite ni sustituye de forma admitida al ZIP de respaldo.

Se validan directorio del archivo y cabeceras locales antes de publicar.
Entradas duplicadas/desconocidas, traversal, symlinks, solapamientos, opciones
ZIP no admitidas, truncamiento y discrepancias CRC/hash/MAC rechazan el paquete.
Límites: base de 64 GiB, identidad de 4 KiB, manifiesto de 64 KiB y envoltura de
16 KiB. Entradas comprimidas heredadas y actuales almacenadas comparten
integridad y publicación atómica.

La base preparada pasa integridad antes de reemplazar. Entre instalaciones se
exige clave de origen o envoltura por contraseña válida: se verifica, cambia
clave solo en staging a la del destino y verifica otra vez. La clave original
debe dejar de abrir la copia cambiada. Fallar conserva destino y muestra error
traducido. ZIP restaura identidad incluida; `.db` heredado conserva identidad
del destino. Es recuperación, no clonación segura de otra caja independiente.

Los ensayos verifican metadatos, integridad y fingerprints por negocio sin
reemplazar la base activa. Instalación firmada, upgrade, downgrade y recuperación
entre claves en equipo representativo siguen siendo evidencia de candidato,
no algo demostrado solo por pruebas unitarias.

## Saneamiento de diagnósticos

`reports.diagnostics.export` sanea JSON `payload`, `summary` y `effectData` del
diario y bandejas al exportar. `sanitizePayload`/`sanitizeRows` reemplazan
recursivamente valores sensibles por `[REDACTED]` y registran nombres ocultos
en `redactedKeysByTable`; el manifiesto indica `sanitized: true`.

`isSensitiveKey()` normaliza mayúsculas/separadores y consulta pertenencia exacta
a `SENSITIVE_KEYS` en `packages/server/src/services/diagnostics/sanitize.ts`.
No busca subcadenas: `pan` es sensible; `pancake_count` y `panel_layout` no.
Incluye autenticación/PIN, secretos de proveedor, tarjetas, certificados/PIN
fiscal y credenciales OAuth/pago. `sessionid` se conserva deliberadamente porque
representa caja, no sesión de autenticación, que usa claves de token sensibles.
Reaplicar es idempotente. Un escritor sensible nuevo debe ampliar conjunto y
pruebas. Una lista de denegación acota protección; no prueba ausencia de todos
los datos personales libres de cualquier exportación.

## Política de tarjetas y límites de verificación

Ningún esquema operativo debe guardar estas columnas:

```
pan, cvv, cvc, card_number, cardnumber, primary_account_number,
primaryaccountnumber, cardholder_name, cardholdername
```

`packages/server/src/__tests__/architectural-lint.test.ts` extrae nombres
literales de `text(...)`, `integer(...)`, `real(...)`, `blob(...)` y
`numeric(...)`; rechaza los prohibidos exactos y permite `panel_layout`,
`pancake_count` y `password_hash` benignos.

La prueba actual solo lee `db/schema.ts`, ahora un barrel de exportaciones;
no verifica recursivamente `db/schema/`. Una comprobación separada de fuente,
solo lectura, realizada en esta revisión no encontró nombres prohibidos en
los módulos, pero el gate mantenido aún necesita esa cobertura. No lo anuncies
como cobertura completa del esquema. Es una brecha de verificación, no evidencia de tarjetas almacenadas.

`sale_payments.reference` solo describe referencia de proveedor/transferencia,
nunca PAN/CVV. Adaptadores deben conservar referencias de tokens y comprobar
cada columna/payload nuevo contra esta política y el saneamiento de exportación.

## Alternativas y consecuencias

- **Solo cuenta del SO:** insuficiente al copiar archivos; requiere SQLCipher,
  custodia de clave y cambio explícito entre instalaciones.
- **Solo lista permitida de diagnósticos:** más fuerte, pero exige mantener
  proyecciones por tabla. La denegación exacta es el límite implementado;
  agregar campos no debe debilitarlo silenciosamente.
- **Regenerar siempre identidad al restaurar:** pierde recuperación del equipo.
  Clonar o restablecer identidad necesita acción administrativa diseñada aparte.
- **Diferir indefinidamente almacenamiento seguro:** ya superado; Electron
  `safeStorage` protege envolturas de instalación y bóveda.
- **Afirmar auditoría autoritativa por cada backup/restauración:** no es actual.
  Crear usa logger estructurado; atribuir actor tras restaurar necesita diseño
  consciente de sesión. Revelar claves tiene su propio límite administrativo auditado.

## Implementación y compatibilidad

- `apps/desktop/src/main/backup/backup-bundle/`: ZIP por streaming, envoltura,
  autenticidad, integridad/cambio de clave, formato, extracción acotada y limpieza.
- `apps/desktop/src/main/ipc/backup/`: handlers autenticados de backup,
  restauración, clave, programación, bóveda y ensayos; las sesiones autorizan acciones.
- `packages/server/src/services/diagnostics/sanitize.ts` y
  `packages/server/src/trpc/routers/reports/diagnostics/`: saneamiento y exportación.
- `packages/server/src/__tests__/diagnostics-sanitize.test.ts`,
  `packages/server/src/__tests__/diagnostics-export-sanitization.test.ts` y
  `apps/desktop/src/main/__tests__/backup-restore.test.ts`: regresiones específicas.
- Importar `.db` crudo heredado sigue admitido; binarios antiguos pueden no
  entender ZIP/envoltura nuevos. Nunca pruebes downgrade reemplazando una base activa.
- Los metadatos son aditivos, pero los valores sensibles pasan a `[REDACTED]`;
  ningún consumidor debe depender del secreto original.
- El export actual incluye `webhook_outbox`, no un placeholder pendiente.
  Recuperación física y proveedor de producción requieren evidencia separada.
  Sigue [Pruebas](../../TESTING.md) y [Procedimientos operativos](../../OPERATIONS-RUNBOOKS.md).
