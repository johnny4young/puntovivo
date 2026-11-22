# Triage de contribuciones

**Idioma:** Español · [English](../../../.github/triage/REVIEW.md)

Cada pull request e issue de un colaborador externo recibe una primera revisión automática de [Centinela](https://github.com/johnny4young/centinela).
Publica un solo comentario, lo mantiene actualizado y define el estado `centinela` en la pull request.
Un mantenedor revisa igualmente cada contribución; el bot solo se asegura de que esté lista para esa revisión.

## Qué revisa

| Área         | Pull request                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Descripción  | Título Conventional Commit y las secciones **Qué**, **Por qué** y **Cómo probar** de la plantilla                      |
| Evidencia    | Capturas o una grabación para cambios de interfaz, pasos de reproducción para correcciones, pruebas para código nuevo  |
| Tamaño       | Líneas cambiadas sin lockfiles ni archivos generados; a las pull requests grandes se les pide dividir o justificar     |
| Idioma       | Ortografía en las líneas agregadas, textos en español con registro usted, cada clave de traducción en inglés y español |
| Seguridad    | Workflows, scripts de instalación, licencias, protecciones de Electron, Unicode oculto, secretos, bloques codificados  |
| Identidad    | Commits con la identidad de un mantenedor sin firma verificada                                                         |
| Dependencias | Dependencias nuevas, su licencia y hace cuánto se publicó la versión                                                   |

Los issues que reportan un error necesitan pasos para reproducirlo, comportamiento esperado y actual, la versión de Puntovivo y el sistema operativo.
Los reportes que parecen una vulnerabilidad se dirigen al proceso privado de [SECURITY](../SECURITY.md).

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

## Mejorar las reglas

Las reglas de Puntovivo viven en `.github/centinela.json`; los chequeos viven en el [repositorio de Centinela](https://github.com/johnny4young/centinela).
Cualquier cambio en uno u otro cambia la versión de las reglas, así que cada contribución abierta se revisa una vez más con las reglas nuevas.

Para probar un cambio contra una pull request real sin publicar nada, desde una copia de Centinela:

```bash
GITHUB_REPOSITORY=johnny4young/puntovivo GH_TOKEN=$(gh auth token) node src/centinela.mjs --dry-run --force --pr 123 --config ../puntovivo/.github/centinela.json
```
