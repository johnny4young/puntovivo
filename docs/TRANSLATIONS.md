# Documentation languages / Idiomas de la documentación

## English

Project documentation is being maintained in English and neutral Latin American
Spanish. Language selectors link complete counterparts; a Spanish index link
marked “inglés” intentionally opens a document that has no Spanish counterpart.
The current maintained pairs are listed below. Coverage is partial: unlisted
current guides remain in English and must not be presented as translated.

| Topic / Tema                                                            | English                                       | Español                                          |
| ----------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------ |
| Product, installation, development / Producto, instalación y desarrollo | [README](../README.md)                        | [README](../README.es.md)                        |
| Contribution / Contribución                                             | [Contributing](../CONTRIBUTING.md)            | [Contribuir](../CONTRIBUTING.es.md)              |
| Documentation index / Índice                                            | [Index](./README.md)                          | [Índice](./es/README.md)                         |
| Environment / Entorno                                                   | [Environment](./ENVIRONMENT_CONFIGURATION.md) | [Entorno](./es/ENVIRONMENT_CONFIGURATION.md)     |
| Recovery / Recuperación                                                 | [Troubleshooting](./TROUBLESHOOTING.md)       | [Solución de problemas](./es/TROUBLESHOOTING.md) |
| Printing / Impresión                                                    | [Printer setup](./PRINTER-SETUP.md)           | [Impresoras](./es/PRINTER-SETUP.md)              |

New public guides need both languages, either as a registered pair or a complete
bilingual document. Maintain both versions when changing a listed guide. Keep code blocks, commands,
paths, identifiers, examples, security requirements and readiness limits exact.
Update relative links for the translation's directory. Do not translate
third-party dependencies, generated content or historical release notes as
current guides. `CHANGELOG.md` is generated technical history; versioned files
under `docs/releases/` are historical product notes. The release-authoring
`docs/releases/README.md` remains current project documentation.

The registry is [translations.json](./translations.json). From the repository
root, validate links, reciprocal selectors, heading structure and code/identifier
parity with:

```bash
pnpm run ci:docs
node scripts/check-documentation-translations.mjs
node scripts/check-documentation-translations.mjs --inventory
```

CI runs these checks when project Markdown, the registry or the checker changes,
without installing application dependencies.

These checks are structural. Review the meaning and technical accuracy in both
languages; passing checks alone does not certify translation quality. The
inventory includes only Git-tracked project Markdown, omits dependency/generated
output, distinguishes historical files and reports current uncovered sources.

## Español

La documentación del proyecto se mantiene progresivamente en inglés y español
latinoamericano neutro. Los selectores de idioma enlazan las versiones
completas. Un enlace del índice español marcado «inglés» abre deliberadamente
un documento que aún no tiene versión española. La tabla anterior identifica
los pares mantenidos. La cobertura es parcial: las guías actuales no listadas
siguen en inglés y no deben presentarse como traducidas.

Las guías públicas nuevas necesitan ambos idiomas, como un par registrado o
un documento bilingüe completo. Actualiza ambas versiones al modificar una guía
de la tabla. Conserva bloques
de código, comandos, rutas, identificadores, ejemplos, requisitos de seguridad
y límites de preparación técnica. Ajusta los enlaces relativos al directorio
de la traducción. No traduzcas dependencias externas, contenido generado ni
notas históricas de releases como si fueran guías vigentes. `CHANGELOG.md` es
historial técnico generado; los archivos versionados de `docs/releases/` son
notas históricas del producto. `docs/releases/README.md`, que explica cómo
redactar releases, sigue siendo documentación vigente.

El registro está en [translations.json](./translations.json). Ejecuta desde la
raíz los dos comandos anteriores para comprobar enlaces, selectores recíprocos,
estructura de títulos y paridad de código e identificadores.

CI ejecuta estas comprobaciones al cambiar Markdown del proyecto, el registro
o el verificador, sin instalar dependencias de la aplicación.

Las comprobaciones son estructurales. Revisa el significado y la exactitud
técnica en ambos idiomas; que pasen no certifica por sí solo la calidad de la
traducción. El inventario incluye únicamente Markdown del proyecto versionado
en Git, excluye dependencias y salidas generadas, distingue los archivos
históricos y muestra los documentos fuente vigentes sin traducción.
