# Notas de release centradas en las personas

**Idioma:** Español · [English](../../releases/README.md)

Los releases GitHub comunican producto; no son una copia del log de commits.
Conserva `CHANGELOG.md` como historia técnica generada y agrega aquí un archivo
curado por cada etiqueta pública.

## Estructura requerida

Cada archivo `vX.Y.Z.md` incluye:

1. **Por qué importa este release:** problema que resuelve en lenguaje cotidiano.
2. **Qué cambió:** agrupado por resultado para el operador, no por área de código.
3. **Antes de usarlo:** límites, migraciones y evidencia que todavía falta.
4. **Descargas:** enlace al release GitHub correspondiente y disponibilidad clara por plataforma.

Escribe primero para propietarios, gerentes y cajeros. Los detalles técnicos
van en un apéndice corto o enlace al changelog generado. Nunca insinúes
certificación fiscal, homologación de hardware, nube, cobertura de soporte ni
fecha de entrega sin evidencia reciente.

## Flujo de release

Antes de fusionar una PR de Release Please:

1. Determina la versión propuesta.
2. Agrega `docs/releases/vX.Y.Z.md` a `main` con la estructura anterior.
3. Contrasta afirmaciones con `docs/PROJECT-STATUS.md` y evidencia del candidato.
4. Ejecuta `pnpm run ci:release`.
5. Espera que pase el estado `Curated release notes` de la PR.

`ci:release` falla si no existe una nota curada para la versión de
`.release-please-manifest.json`. Este control existe porque v1.11.0 a v1.14.1
y v1.14.3 se publicaron sin ella: el publicador usa la etiqueta, por lo que
una nota posterior solo llega al release mediante edición manual.

El control no se ejecuta solo en una PR de Release Please. Sus commits son de
`github-actions[bot]`, por lo que GitHub mantiene CI como `action_required`
hasta que un mantenedor lo apruebe en Actions. `Curated release notes` no
requiere aprobación: tras cada push a `main`, `.github/workflows/release-please.yml`
lo publica en la PR abierta. Falla si `main` no tiene nota válida para la
versión propuesta y pasa cuando la tiene. La nota pertenece a `main`, no a la
rama de PR que Release Please reescribe al actualizarla. Como vive en `main`,
no aparece en el diff; confírmala mediante el estado. `main` no exige checks,
por lo que ni el estado ni CI impiden por sí solos fusionar la PR.

Cuando Release Please crea la etiqueta, `.github/workflows/release-please.yml`
usa esa etiqueta exacta y reemplaza el cuerpo generado del release GitHub
con el archivo curado. `CHANGELOG.md` sigue disponible para el detalle por commit.
