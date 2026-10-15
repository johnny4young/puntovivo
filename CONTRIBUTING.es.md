# Contribuir a Puntovivo

**Idioma:** Español · [English](./CONTRIBUTING.md)

Gracias por tu interés en Puntovivo. Esta guía reúne lo esencial para trabajar
en el código del proyecto.

## Preparar el entorno de desarrollo

Requisitos: Node.js `>=24`, pnpm `11.x` (mediante Corepack).

```bash
corepack enable
pnpm install
pnpm --filter @puntovivo/desktop run native:ensure:electron   # verify the bundled Node-API prebuild loads under Electron
```

Después de `pnpm install`, verifica que los módulos nativos incluidos carguen en
Electron. `better-sqlite3` y `argon2` distribuyen binarios Node-API precompilados:
no se recompilan desde el código fuente ni hay que resolver diferencias de
`NODE_MODULE_VERSION` entre las versiones principales de Node y Electron. El
comando anterior solo comprueba que el binario incluido cargue. Consulta el
[README](./README.es.md) para ver los comandos y las notas del entorno de ejecución.

## Convenciones de commits

Este repositorio usa [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `docs:`, `build:`, `chore:`, `ci:`, `test:`,
`perf:`. Indica el módulo como alcance, por ejemplo, `feat(products):`, `fix(auth):`.

release-please automatiza las versiones y el registro de cambios a partir de
estos tipos de commit; por eso deben describir el cambio con precisión.

## Verificaciones antes de abrir un PR

Ejecuta la validación de CI del área modificada; son los mismos comandos que usa CI:

| Área                                                    | Comando               |
| ------------------------------------------------------- | --------------------- |
| `apps/web` (React / TypeScript)                         | `pnpm run ci:web`     |
| `packages/server` (backend)                             | `pnpm run ci:server`  |
| `apps/desktop/src/main` (proceso principal de Electron) | `pnpm run ci:desktop` |

Cada comando ejecuta comprobación de tipos, lint y pruebas; web y desktop también
compilan. Si un cambio afecta al frontend y al backend, deben pasar tanto
`ci:web` como `ci:server`.

## Pull requests

- Mantén un cambio lógico por PR.
- Comprueba que la validación de CI correspondiente pase localmente.
- Internacionaliza todos los textos visibles para el usuario en inglés y español;
  el español usa el registro `tú` del español latinoamericano neutro.
- Las guías públicas nuevas necesitan versiones en inglés y español enlazadas
  entre sí. Registra los pares en `docs/translations.json` y ejecuta
  `node scripts/check-documentation-translations.mjs`; consulta las
  [reglas de idiomas de la documentación](./docs/TRANSLATIONS.md).

## Informar problemas de seguridad

No abras issues públicos para reportar vulnerabilidades. Consulta
[SECURITY (español)](./docs/es/SECURITY.md) para conocer el procedimiento responsable.
