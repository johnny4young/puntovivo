# Rechazo de confirmación al desactivar producto

**Idioma:** Español · [English](../PRODUCT-DEACTIVATION-UI.md)

## Objetivo y comportamiento

En app1.15.3/base404b5d7294ea021a5863d2149c79bf483a498b73, la confirmación
espera `deleteMutation.mutateAsync` sin manejar su rechazo. La mutación muestra el
toast localizado, pero la promesa aún rechaza hacia un click React que no la
consume. El laboratorio observó ese rechazo sin capturar en inglés y español.

La página maneja ahora el rechazo ya informado, igual que sus handlers existentes
de crear/editar. La mutación sigue siendo la única dueña del toast de error. La
confirmación permite reintentar o cancelar; solo el éxito invalida la lista,
cierra y muestra éxito. No hay desactivación optimista ni toast nuevo en el catch.
No cambia el modal compartido ni sus otros consumidores.

## Reproducir y validar

Usa un checkout desechable nuevo, Node24.21.0 y pnpm11.7.0 local, incluso para
llamadas anidadas. Entorno hijo limpio sin configuración heredada de base/
proveedor/firma/telemetría y lane pesado cooperativo. Grafo de recuperación
probado:composición congelada344(Vitest5.0.3,jsdom30.1.1); este parche no cambia
manifests de dependencias ni lockfile.

```sh
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm --filter @puntovivo/shared run build
node node_modules/vitest/vitest.mjs run --root apps/web --config vitest.config.ts src/features/products/ProductsPage.details.test.tsx src/features/products/ProductsPage.moduleGate.test.tsx src/features/products/ProductFormModal.test.tsx --maxWorkers=1
corepack pnpm --filter @puntovivo/web run typecheck
corepack pnpm --filter @puntovivo/web run lint
corepack pnpm exec prettier --check apps/web/src/features/products/ProductsPage.tsx apps/web/src/features/products/ProductsPage.details.test.tsx
node scripts/check-documentation-translations.mjs
```

El fixture existente conserva tabla/drawer reales, simula los modales pesados y
el ciclo de mutación en la frontera tRPC. Los casos nuevos EN/ES invocan el callback
exacto de confirmación y verifican promesa resuelta sin rechazo sin capturar, un
solo toast localizado, ningún éxito/invalidación tras fallo, confirmación abierta,
reintento exitoso y cancelación sin solicitud. El transporte sintético no llama
al backend.

Copia solo el test cambiado a un checkout original aislado para comparar antes:
pasan6casos y fallan2de rechazo EN/ES. Después pasan48casos en los tres archivos
indicados. Se verificó que la página antes era idéntica en bytes a la base
original. No usa base de datos, proveedor fiscal ni impresora física.

## Límites

Solo maneja la promesa del renderer. Rollback y versiones del backend pertenecen
a343; las transacciones de catálogo son346. No cambia la política global del
modal, permisos, textos ni redondeo. La evidencia de navegador EN/ES precede la
reparación; estas regresiones de componentes no afirman una nueva calificación
real de navegador o Electron. CI remoto requiere componer dependencias; no se
añade excepción de audit. Draft no equivale a listo para merge.
