# Triage de contribuciones

**Idioma:** Español · [English](../../../.github/triage/REVIEW.md)

Cada pull request e issue de un colaborador externo recibe una primera revisión automática de [Centinela](https://github.com/johnny4young/centinela).
Publica un solo comentario, lo mantiene actualizado y define el estado `centinela` en la pull request.
Un mantenedor revisa igualmente cada contribución; el bot solo se asegura de que esté lista para esa revisión.

## Qué revisa

| Área         | Pull request                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Descripción  | Título Conventional Commit y las secciones **Qué**, **Por qué** y **Cómo probar** de la plantilla                                                          |
| Evidencia    | Capturas o una grabación para cambios de interfaz, pasos de reproducción para correcciones, pruebas para código nuevo                                      |
| Tamaño       | Líneas cambiadas sin lockfiles ni archivos generados; a las pull requests grandes se les pide dividir o justificar                                         |
| Idioma       | Ortografía en las líneas agregadas, textos en español con registro usted, cada clave de traducción en inglés y español                                     |
| Seguridad    | Workflows, scripts de instalación, licencias, protecciones de Electron, Unicode oculto, secretos, bloques codificados                                      |
| Identidad    | Commits con la identidad de un mantenedor sin firma verificada                                                                                             |
| Dependencias | Dependencias nuevas, su licencia y hace cuánto se publicó la versión                                                                                       |
| Higiene      | Conflictos de merge, migraciones secuenciales de Drizzle que chocan con `main`, commits compartidos con otra pull request abierta, chequeos de CI fallidos |

Los issues que reportan un error necesitan pasos para reproducirlo, comportamiento esperado y actual, la versión de Puntovivo y el sistema operativo.
Los reportes que parecen una vulnerabilidad se dirigen al proceso privado de [SECURITY](../SECURITY.md).

Los chequeos de higiene comparan la pull request con `main` y con las demás pull requests abiertas. Un choque de migraciones significa que la pull request agrega una migración en `packages/server/src/db/migrations/` cuyo número secuencial ya está ocupado en `main` o queda detrás del más reciente allí; el autor debe generar de nuevo la migración sobre el `main` actual.

## Resultados

- **Para avanzar**: el autor debe corregirlo; la pull request recibe `status: waiting-on-author`.
- **Requiere revisión de un mantenedor**: un mantenedor debe revisarlo; la pull request recibe `status: needs-maintainer`.
- **Sugerencias**: vale la pena hacerlas, nunca bloquean.

El estado `centinela` falla mientras alguno de los dos primeros grupos tenga puntos. La etiqueta `triage: approved` los marca como aceptados por un mantenedor para el commit actual; un push nuevo necesita otra aprobación.
Los issues incompletos reciben `needs-info`.

## Cuándo se ejecuta

Se ejecuta de nuevo solo cuando cambia algo que lee: un commit nuevo, el título, la descripción, las etiquetas de activación o aprobación, o sus propias reglas.
Las contribuciones de mantenedores se omiten salvo que lleven la etiqueta `triage`. Los borradores y las cuentas de automatización se omiten.

El workflow se ejecuta desde `main` y lee la pull request solo mediante la API de GitHub; nunca descarga ni ejecuta el código contribuido.

## Solicitudes de mantenedores

Un mantenedor puede pedirle más a Centinela con una etiqueta. Centinela quita la etiqueta en cuanto toma la solicitud, así que aplicarla de nuevo pide una nueva ejecución.

| Etiqueta               | Se aplica a  | Qué hace                                                                                                                             |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `centinela: ai-review` | Pull request | Revisión profunda con IA del diff según las [reglas de código](#reglas-de-código); sus hallazgos nunca cambian el estado `centinela` |
| `centinela: triage`    | Issue        | Triage de issues con IA: posibles duplicados, errores ya corregidos por una pull request fusionada y orientación para contribuir     |
| `centinela: learn`     | Cualquiera   | Recopila las revisiones recientes de los mantenedores y abre o actualiza una pull request con las reglas aprendidas                  |
| `centinela: draft-pr`  | Issue        | Ejecuta el workflow aparte `Centinela Execute`, que implementa el issue en una rama nueva y abre una Draft PR                        |

La Draft PR creada con `centinela: draft-pr` se omite mientras sea un borrador; cuando se marca como lista para revisión, Centinela la revisa como cualquier otra pull request y igualmente necesita que un mantenedor la revise y la fusione.

También puede comentar `/centinela review` en una pull request para pedir de nuevo la revisión con IA, o `/centinela draft-pr` en un issue. `Centinela Execute` solo acepta ese comentario del propietario, los miembros y los colaboradores del repositorio.

Si usted responde a un hilo de revisión de Centinela, o menciona a `@centinela` en un comentario, recibe una respuesta basada en estas reglas. Cuando la respuesta muestra que un hallazgo es un falso positivo y Centinela lo confirma, el hilo se resuelve automáticamente y el descarte queda registrado para revisiones futuras.

## Reglas de código

Un mantenedor puede pedir a Centinela una revisión con IA con la etiqueta `centinela: ai-review`. La revisión lee la versión en inglés de esta sección como reglas del proyecto, así que solo incluye reglas que se puedan verificar en un diff.

**Datos multi-tenant**

- Toda consulta en un router de tRPC filtra por `ctx.tenantId`.
- Un procedimiento que recibe un `siteId` llama a `ensureTenantSite(ctx.db, ctx.tenantId, siteId)`.
- Los permisos por rol usan `adminProcedure`, `managerOrAdminProcedure` o `createRoleGuard`; nunca un middleware propio.

**API y escritorio**

- `/api/trpc` es la API de la aplicación. No se agregan rutas REST; solo quedan `/api/health` y `/api/realtime/*`.
- El renderer de Electron está aislado: una API nueva del preload es un envoltorio de una línea sobre `ipcRenderer.invoke`, conectado a un canal `ipcMain.handle`.
- El servidor integrado corre en un worker thread. El proceso principal llega a él solo mediante `apps/desktop/src/main/server-host/` y nunca importa `@puntovivo/server`.
- El proceso principal nunca se bloquea: nada de trabajo síncrono de archivos, procesos o criptografía.

**Base de datos**

- Los cambios de esquema van en `packages/server/src/db/schema.ts` con una migración generada por `drizzle-kit`. El SQL escrito a mano usa `IF NOT EXISTS`.
- Nunca `.default(null)` en una columna de texto `{ mode: 'json' }`: guarda el texto `null`.
- El código de la aplicación nunca escribe `product_stock_totals`; lo mantienen los triggers de la base de datos.
- Las actualizaciones del catálogo usan la actualización versionada que lanza `STALE_VERSION` ante un conflicto.

**Dinero, ventas y documentos fiscales**

- Todo valor monetario intermedio pasa por `roundMoney()`. El total a pagar usa `resolvePayableTotal`.
- Completar una venta requiere una sesión de caja activa, y los movimientos de caja pasan por `insertCashMovement`.
- Un documento fiscal, su entrada en el outbox y el avance de la numeración se escriben en una sola transacción. La emisión ocurre después del commit y nunca revierte la venta.
- Un documento fiscal emitido nunca cambia.

**Textos de la interfaz**

- Todo texto visible vive en `apps/web/src/i18n/locales/`, en `en` y en `es`.
- Los textos en español usan español latinoamericano neutro con usted: nunca voseo ni tú.

**Pruebas**

- Un procedimiento nuevo de tRPC necesita una prueba de servidor que llame al router con el caller de tRPC y una base de datos en memoria, incluido el aislamiento por tenant cuando lee o escribe datos de un tenant.

## Mejorar las reglas

Las reglas de Puntovivo viven en `.github/centinela.json`; los chequeos viven en el [repositorio de Centinela](https://github.com/johnny4young/centinela).
Cualquier cambio en uno u otro cambia la versión de las reglas, así que cada contribución abierta se revisa una vez más con las reglas nuevas.

Para previsualizar una ejecución desde GitHub sin publicar nada, abra **Actions → Centinela → Run workflow**, elija un `mode` (`review`, `triage` o `learn`), escriba el `number` de la pull request o del issue y mantenga `dry_run: true`. El resultado aparece en el resumen del job (Job Summary) de la ejecución en lugar de un comentario en la pull request o el issue.

Para probar un cambio contra una pull request real sin publicar nada, desde una copia de Centinela:

```bash
GITHUB_REPOSITORY=johnny4young/puntovivo GH_TOKEN=$(gh auth token) node src/centinela.mjs --dry-run --force --pr 123 --config ../puntovivo/.github/centinela.json
```
