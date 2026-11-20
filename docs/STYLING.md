# Styling Guide

**Language:** English · [Español](es/STYLING.md)

> Updated: November 15, 2026

## Current Styling Stack

Puntovivo currently uses:

- Tailwind CSS v4 via the Vite plugin
- CSS variables in `styles/theme.css`, imported by `index.css`
- `class-variance-authority` for component variants
- `tailwind-merge` through the shared `cn()` helper

Primary files:

- [index.css](../apps/web/src/index.css)
- [theme.css](../apps/web/src/styles/theme.css)
- [utils.ts](../apps/web/src/lib/utils.ts)

## Theme Model

The app supports:

- `light`
- `dark`
- `system`

Theme state is managed through:
[ThemeProvider.ts](../apps/web/src/components/feedback/ThemeProvider.ts)

Behavior:

- browser mode persists preference in localStorage
- desktop mode also syncs preference through the Electron bridge
- the provider toggles the `dark` class on the root element

## Color System

`styles/theme.css` defines:

- semantic OKLCH variables for background, foreground, border, etc.
- custom palettes for:
  - primary
  - secondary
  - success
  - warning
  - danger

These are consumed directly in Tailwind utility classes such as:

- `bg-primary-50`
- `text-secondary-700`
- `border-warning-500`

## Typography and Layout Tokens

Fonts are bundled (see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.en.md)):

- `font-sans` (Instrument Sans): interface text.
- `font-display` (Bricolage Grotesque, width 88): titles. `h1`–`h3` use it by default.
- `font-numeric` (Bricolage Grotesque, width 80, tabular lining figures): money and counts.
- `font-mono` (DM Mono): codes, SKUs and key caps (`.pv-kbd`).

Palette roles: ink on cool paper for the interface; blue (`primary`) for live
state and focus; orange only for Cobrar (`bg-cobrar`, `Button variant="charge"`);
the navy `rail` for navigation and the brand tile. Severity uses
`SeverityMark`, which pairs shape and colour: diamond = blocks, half circle =
before closing, empty circle = when possible, check = ready.

Rules: no leading colour bar on rows, cards or notices (use a tint, weight,
an icon or a full border); one primary action per screen; text contrast at
least 4.5:1 in light and dark (`scripts/check-contrast.mjs`).

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
