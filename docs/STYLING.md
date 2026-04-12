# Styling Guide

> Updated: April 9, 2026

## Current Styling Stack

Puntovivo currently uses:

- Tailwind CSS v4 via the Vite plugin
- CSS variables in `index.css`
- `class-variance-authority` for component variants
- `tailwind-merge` through the shared `cn()` helper

Primary files:

- [index.css](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/index.css)
- [utils.ts](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/lib/utils.ts)

## Theme Model

The app supports:

- `light`
- `dark`
- `system`

Theme state is managed through:
[ThemeProvider.tsx](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/components/feedback/ThemeProvider.tsx)

Behavior:

- browser mode persists preference in localStorage
- desktop mode also syncs preference through the Electron bridge
- the provider toggles the `dark` class on the root element

## Color System

`index.css` defines:

- semantic HSL variables for background, foreground, border, etc.
- custom palettes for:
  - primary
  - secondary
  - success
  - warning
  - danger

These are consumed directly in Tailwind utility classes such as:

- `bg-primary-50`
- `text-secondary-700`
- `border-warning-200`

## Typography and Layout Tokens

The current theme also defines:

- `--font-sans`
- `--font-mono`
- custom spacing tokens
- custom shadows
- custom animations

## Component Variant Pattern

Shared primitives use CVA where variants matter, for example buttons and badges.

Typical pattern:

1. define base classes
2. define named variants
3. define default variants
4. merge with `cn()`

This keeps variant APIs typed and avoids repeated class-condition logic.

## Current UX Patterns

### Feedback colors

- success states use green palette
- warnings use amber palette
- destructive/error states use red palette
- informational/neutral shell surfaces use secondary palette

### Card and panel language

The app currently prefers:

- rounded panels
- subtle borders
- light secondary backgrounds for neutral information
- colored state cards for warnings, success, and status summaries

### Table-heavy screens

Tables are still a dominant interaction model across the app.
Shared table styling now includes:

- export action strip
- skeleton loading state
- retry/error state
- keyboard navigation

## Guidelines for New UI Work

- use shared UI primitives before inventing new base components
- use semantic palette classes instead of ad hoc hex colors
- keep destructive actions visually consistent with existing confirm modals
- keep feature-specific styles inside the feature unless they are clearly reusable
- prefer extending `index.css` tokens or existing variant APIs before adding one-off styling utilities

## Known Follow-Up

- bundle size from export/reporting dependencies is still a known warning during build
- responsive polish is stronger in some modules than others
- future visual work should continue aligning older screens with the shared feedback and table primitives
