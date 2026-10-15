# Guía de componentes

**Idioma:** Español · [English](../COMPONENTS.md)

> Actualizado: 9 de abril de 2026

## Descripción

La interfaz compartida en `apps/web/src/components` se organiza por responsabilidad,
no por dominio de negocio. La composición específica pertenece a `apps/web/src/features`.

## Áreas actuales de componentes compartidos

### `components/ui`

Primitivas reutilizables de bajo nivel:

- `Button`
- `Input`
- `Label`
- `Badge`
- `Card`
- `Table`

Úsalas como bloques visuales genéricos sin reglas de negocio.

### `components/form-controls`

Controles reutilizables de entrada y modales:

- `Select`
- `Checkbox`
- `DatePicker`
- `FormField`
- `Modal`
- `ConfirmModal` mediante `Modal.tsx`

Son los controles compartidos de formularios y confirmaciones de las funciones.

### `components/feedback`

Respuesta de estructura y consultas:

- `AppErrorBoundary`
- `LoadingState`
- `QueryErrorState`
- `ToastProvider`
- `ThemeProvider`

Es la capa preferida para carga, reintento, notificaciones y tema de toda la aplicación.

### `components/layout`

Estructura de la aplicación:

- `MainLayout`
- `Header`
- `Sidebar`
- `GlobalStatusStrip`

### `components/tables`

Infraestructura compartida de tablas y listas:

- `DataTable`
- `TableToolbar`
- `TableExportActions`
- `TableLoadingState`
- `TableErrorState`

### `components/resources`

`ResourcePage` es el contenedor compartido de varias pantallas administrativas
CRUD para mantener carga, errores, barra de herramientas y disposición de tabla coherentes.

### `components/dialogs`

Actualmente incluye:

- `ProductSearchDialog`

Es un diálogo reutilizable entre funciones empleado en ventas.

## Patrón de composición por función

Los componentes compartidos terminan donde comienzan las reglas de negocio.
Por ejemplo:

- `SaleDetailsModal` pertenece a `features/sales`.
- `CompanySyncCard` pertenece a `features/company`.
- `ProviderCategoryAssignmentsModal` pertenece a `features/providers`.

Así las carpetas genéricas no acumulan lógica de dominio.

## Reglas de uso preferidas

### Usa primitivas compartidas de respuesta

Prefiere:

- `ToastProvider` para éxito/error de mutaciones.
- `LoadingState`, `TableLoadingState` o `QueryErrorState` para interfaz asíncrona.
- `AppErrorBoundary` para proteger la estructura frente a fallos.

### Usa patrones de modal compartidos

Prefiere:

- `Modal` para formularios/detalles.
- `ConfirmModal` para acciones destructivas.

Esto mantiene coherencia visual y de comportamiento al destruir datos.

### Usa patrones de tabla compartidos

Prefiere:

- `DataTable` cuando la pantalla encaja en el modelo estándar.
- `TableExportActions` para Excel/PDF/impresión.
- `TableLoadingState` y `TableErrorState` para carga/error de listas.

## Módulos funcionales actuales que conviene conocer

Los principales módulos construidos sobre componentes compartidos son:

- auth
- company
- customer-catalogs
- customers
- dashboard
- geography
- inventory
- locations
- orders
- products
- providers
- purchases
- sales
- sites
- units
- users
- vat-rates

## Restricciones de diseño

- Los componentes compartidos permanecen independientes del negocio.
- El estado asíncrono del servidor permanece en TanStack Query, sin duplicarse localmente.
- Divide diálogos/páginas grandes cuando acumulen demasiada lógica de flujo.

Para la estructura en ejecución y rutas, consulta:
[ARCHITECTURE.md](ARCHITECTURE.md).
