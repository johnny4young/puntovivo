# Components Guide

> Updated: April 9, 2026

## Overview

The shared UI in `apps/web/src/components` is organized by responsibility, not by business domain.
Business-specific composition belongs under `apps/web/src/features`.

## Current Shared Component Areas

### `components/ui`

Low-level reusable primitives:

- `Button`
- `Input`
- `Label`
- `Badge`
- `Card`
- `Table`

Use these for generic visual building blocks with no business logic.

### `components/form-controls`

Reusable input and modal controls:

- `Select`
- `Checkbox`
- `DatePicker`
- `FormField`
- `Modal`
- `ConfirmModal` via `Modal.tsx`

These are the shared controls used by feature forms and confirmation flows.

### `components/feedback`

Shell and query feedback:

- `AppErrorBoundary`
- `LoadingState`
- `QueryErrorState`
- `ToastProvider`
- `ThemeProvider`

This is the preferred layer for app-wide loading, retry, toast, and theme behavior.

### `components/layout`

Application shell:

- `MainLayout`
- `Header`
- `Sidebar`
- `OfflineStatusBanner`

### `components/tables`

Shared table and data-list infrastructure:

- `DataTable`
- `TableToolbar`
- `TableExportActions`
- `TableLoadingState`
- `TableErrorState`

### `components/resources`

`ResourcePage` is the shared wrapper used by several CRUD-style admin screens for loading, error,
toolbar, and table-layout consistency.

### `components/dialogs`

Currently includes:

- `ProductSearchDialog`

This is a reusable cross-feature dialog used by sales workflows.

## Feature-Level Composition Pattern

Shared components stop where business rules begin.
Examples:

- `SaleDetailsModal` belongs in `features/sales`
- `CompanySyncCard` belongs in `features/company`
- `ProviderCategoryAssignmentsModal` belongs in `features/providers`

That keeps domain logic out of generic component folders.

## Preferred Usage Rules

### Use shared feedback primitives

Prefer:

- `ToastProvider` for mutation success/error feedback
- `LoadingState`, `TableLoadingState`, or `QueryErrorState` for async UI
- `AppErrorBoundary` for shell-level crash protection

### Use shared modal patterns

Prefer:

- `Modal` for form/detail dialogs
- `ConfirmModal` for destructive actions

This keeps destructive interactions visually and behaviorally consistent.

### Use shared table patterns

Prefer:

- `DataTable` when the screen fits the standard table model
- `TableExportActions` for Excel/PDF/print actions
- `TableLoadingState` and `TableErrorState` for list loading/error states

## Current Feature Modules Worth Knowing

The main feature modules currently composed on top of shared components are:

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

## Design Constraints

- shared components should stay business-agnostic
- async server state should stay in TanStack Query, not duplicated into local component state
- large feature dialogs/pages should be split once they start carrying too much workflow logic

For the live shell and routing context, see:
[ARCHITECTURE.md](/Users/johnny4young/Personal/github/puntovivo/docs/ARCHITECTURE.md)
