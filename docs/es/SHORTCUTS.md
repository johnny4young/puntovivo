# Atajos de teclado

**Idioma:** Español · [English](../SHORTCUTS.md)

> Estado: disponible y cubierto por regresiones. El catálogo canónico es
> `apps/web/src/lib/shortcuts.ts`.

El catálogo define identificadores, teclas, ámbito, etiquetas, rutas y permisos
de roles. De él dependen listeners globales, pistas de la paleta, enlaces de
navegación y controles de acciones exactas; no deben mantener mapas paralelos.

## Responsables en ejecución

| Función                                                 | Responsable                                                    |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Definiciones canónicas y reconocimiento de teclas       | `apps/web/src/lib/shortcuts.ts`                                |
| Navegación global, tema, sede, panel y cierre de sesión | `apps/web/src/components/feedback/GlobalShortcutsProvider.tsx` |
| Panel de atajos diferido y confirmación de cierre       | `apps/web/src/components/feedback/GlobalShortcutsSheet.tsx`    |
| Acciones de venta, carrito y caja                       | `apps/web/src/features/sales/useSalesKeyboardShortcuts.ts`     |
| Pistas de rutas de la paleta                            | `apps/web/src/lib/commandPaletteActions.ts`                    |

`Mod` significa `Command` en macOS y `Control` en Windows/Linux. El comparador
acepta `Meta` fuera de macOS para teclados externos. Los atajos Alt globales
usan con cuidado el código físico cuando macOS produce caracteres compuestos,
pero nunca reasignan una tecla imprimible normal por su posición.

## Catálogo actual

### Globales

| Id                   | Teclas        | Roles                   | Acción                                                                            |
| -------------------- | ------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `palette.open`       | `Mod+K`       | authenticated           | Abrir la paleta de comandos.                                                      |
| `nav.dashboard`      | `Alt+1`       | admin, manager, viewer  | Ir al panel principal.                                                            |
| `nav.sales`          | `Alt+2`       | admin, manager, cashier | Ir a ventas.                                                                      |
| `nav.inventory`      | `Alt+3`       | admin, manager          | Ir a inventario.                                                                  |
| `nav.purchases`      | `Alt+4`       | admin, manager          | Ir a compras.                                                                     |
| `app.shortcutsSheet` | `Alt+/`       | authenticated           | Abrir o cerrar el panel de atajos. Admite distribuciones españolas con `Shift+7`. |
| `app.themeToggle`    | `Alt+Shift+D` | authenticated           | Alternar tema claro/oscuro.                                                       |
| `app.switchSite`     | `Alt+Shift+S` | authenticated           | Seleccionar la siguiente sede activa si hay otra.                                 |
| `app.logout`         | `Alt+Q`       | authenticated           | Pedir confirmación antes de cerrar sesión.                                        |

### Ventas y caja

| Id                       | Teclas        | Acción                                                            |
| ------------------------ | ------------- | ----------------------------------------------------------------- |
| `sales.charge`           | `F1`          | Abrir pago o enviar el formulario si ya tiene el foco.            |
| `sales.fastCash`         | `F2`          | Abrir o restablecer pago en efectivo exacto.                      |
| `sales.productSearch`    | `F5`          | Abrir búsqueda de productos.                                      |
| `sales.focusProduct`     | `Alt+P`       | Enfocar búsqueda de producto/código de barras.                    |
| `sales.focusQuantity`    | `Alt+C`       | Enfocar cantidad de la línea seleccionada.                        |
| `sales.focusDiscount`    | `Alt+D`       | Enfocar descuento de la línea seleccionada.                       |
| `sales.focusUnit`        | `Alt+U`       | Enfocar selector de unidad en búsqueda de productos.              |
| `sales.suspend`          | `Mod+P`       | Suspender un carrito que cumpla los requisitos.                   |
| `sales.toggleSuspended`  | `Mod+R`       | Alternar carritos suspendidos si la acción corresponde al estado. |
| `sales.reprint`          | `Mod+Shift+P` | Reimprimir la fila seleccionada del historial.                    |
| `sales.removeItem`       | `Delete`      | Eliminar la línea seleccionada del carrito.                       |
| `sales.undo`             | `Mod+Z`       | Deshacer la última modificación reversible del carrito.           |
| `sales.newSale`          | `Alt+N`       | Iniciar una venta nueva.                                          |
| `sales.openCashSession`  | `Alt+A`       | Abrir caja si no hay una sesión activa.                           |
| `sales.cashMovement`     | `Alt+M`       | Abrir movimiento de caja con sesión activa.                       |
| `sales.closeCashSession` | `Alt+Shift+C` | Iniciar cierre ciego con sesión activa.                           |

Los atajos de ventas y caja se limitan a admin, manager y cashier. Los controles
de estado dejan inactivas las acciones no disponibles, sin abrir otra alternativa.

## Colisiones y ámbito

- Las acciones globales no se activan si un campo editable u otro modal controla
  el teclado. `Alt+/` puede cerrar su propio panel desde ese panel.
- Los handlers de ventas permanecen en `/sales`; `Alt+U` solo actúa dentro de
  la búsqueda de productos. Deshacer texto nativo tiene prioridad en campos editables.
- Solo se impide la acción del navegador después de que Puntovivo acepte el
  atajo. Por ejemplo, `Mod+R` sigue recargando si no hay acción de carritos suspendidos.
- La prueba de catálogo rechaza una tecla duplicada si ambas definiciones
  pueden estar activas para el mismo rol. Los atajos de navegación deben ser únicos y globales.
- Los permisos coinciden con los controles de ruta antes de ejecutar el listener.
  Las redirecciones son defensa adicional, no la autorización del atajo.
- No agregues atajos a operaciones ambiguas o de varios pasos. Primero expón
  una acción única con permisos y precondiciones explícitos.

## Contrato de accesibilidad

`ariaKeyshortcutsFor(id)` y `ariaKeyshortcutsForRoute(route)` producen valores
WAI-ARIA canónicos: `Meta+P` en macOS y `Control+P` en los demás sistemas. Los
enlaces y controles que ejecutan exactamente esa acción llevan el atributo;
los informativos o de recuperación no anuncian un atajo que no pueden ejecutar.

Actualmente se aplica a navegación móvil/escritorio, acceso a la paleta,
búsqueda y unidad de producto, pago y efectivo rápido, cantidad/descuento/
eliminación/deshacer del carrito, suspendidos, venta nueva y apertura/
movimientos/cierre de caja.

Las pruebas automáticas de accesibilidad y navegador protegen el mapeo, pero
no sustituyen un estudio moderado de teclado ni una prueba real con Windows NVDA.
Esas evidencias de release siguen siendo externas.

## Agregar un atajo

1. Agrega una definición a `SHORTCUTS`, con `route` y `roles` si corresponde a navegación.
2. Agrega etiquetas EN/ES al espacio `shortcuts`.
3. Implementa el listener en el responsable más específico y reutiliza controles de campos editables/modales.
4. Usa `aria-keyshortcuts` solo en controles que ejecutan exactamente esa acción.
5. Amplía pruebas de catálogo, permisos, colisiones y componentes.
6. Actualiza esta guía y comprueba en vivo la superficie afectada.

## Validación

```sh
pnpm --filter @puntovivo/web exec vitest run \
  src/lib/__tests__/shortcuts.test.ts \
  src/components/feedback/GlobalShortcutsProvider.test.tsx \
  src/components/layout/__tests__/Sidebar.test.tsx

pnpm run ci:web
pnpm run test:e2e:web
```

La cobertura automática no implica usabilidad moderada ni pruebas de hardware con NVDA.
