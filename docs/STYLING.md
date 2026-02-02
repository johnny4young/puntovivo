# Styling Guide

> **For New Collaborators**: This document explains the styling architecture, conventions, and best practices for Open Yojob.

---

## Table of Contents

1. [Overview](#overview)
2. [Technology Stack](#technology-stack)
3. [Theme Configuration](#theme-configuration)
4. [CVA Components](#cva-components)
5. [The `cn()` Utility](#the-cn-utility)
6. [Creating New Components](#creating-new-components)
7. [Best Practices](#best-practices)
8. [Migration Notes](#migration-notes)

---

## Overview

Open Yojob uses a modern styling architecture based on:

- **Tailwind CSS v4** with the native Vite plugin (no PostCSS)
- **CVA (class-variance-authority)** for component variants
- **tailwind-merge v3** for intelligent class merging
- **CSS Variables** for theme customization (light/dark mode)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       STYLING STACK                                     │
└─────────────────────────────────────────────────────────────────────────┘

  index.css          →  Theme configuration (@theme block)
       ↓
  Tailwind v4        →  Utility classes (via Vite plugin)
       ↓
  CVA                →  Component variants (variant API)
       ↓
  cn() utility       →  Class merging (clsx + tailwind-merge)
       ↓
  React Component    →  Final rendered element
```

---

## Technology Stack

### Tailwind CSS v4

Tailwind CSS v4 uses a native Vite plugin instead of PostCSS:

```typescript
// vite.config.ts
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

**Key differences from v3:**

- No `tailwind.config.js` file needed
- Theme configured via `@theme` block in CSS
- No `@tailwind base/components/utilities` directives
- Use `@import "tailwindcss"` instead

### class-variance-authority (CVA)

CVA provides a type-safe API for defining component variants:

```typescript
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  // Base classes (always applied)
  'inline-flex items-center justify-center rounded-md font-medium transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-primary-500 text-white hover:bg-primary-600',
        secondary: 'bg-secondary-100 text-secondary-900 hover:bg-secondary-200',
        outline: 'border border-input bg-background hover:bg-accent',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-danger-500 text-white hover:bg-danger-600',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
);
```

### tailwind-merge v3

Intelligently merges Tailwind classes, resolving conflicts:

```typescript
import { twMerge } from 'tailwind-merge';

twMerge('px-4 py-2', 'px-6'); // → 'py-2 px-6'
twMerge('bg-red-500', 'bg-blue-500'); // → 'bg-blue-500'
```

Our `utils.ts` extends tailwind-merge with custom color classes:

```typescript
const customTwMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'primary-50',
        'primary-100',
        /* ... */ 'primary-950',
        'secondary-50' /* ... */,
        'success-50',
        'success-500',
        'success-700',
        'warning-50',
        'warning-500',
        'warning-700',
        'danger-50',
        'danger-500',
        'danger-600',
        'danger-700',
      ],
    },
  },
});
```

---

## Theme Configuration

### The `@theme` Block

All theme customization happens in `index.css` via the `@theme` block:

```css
@import 'tailwindcss';

@theme {
  /* Primary color palette */
  --color-primary-50: #f0f9ff;
  --color-primary-100: #e0f2fe;
  --color-primary-200: #bae6fd;
  --color-primary-300: #7dd3fc;
  --color-primary-400: #38bdf8;
  --color-primary-500: #0ea5e9;
  --color-primary-600: #0284c7;
  --color-primary-700: #0369a1;
  --color-primary-800: #075985;
  --color-primary-900: #0c4a6e;
  --color-primary-950: #082f49;

  /* Semantic colors (reference CSS variables) */
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
  --color-destructive: hsl(var(--destructive));

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  /* Custom spacing */
  --spacing-18: 4.5rem;
  --spacing-88: 22rem;
  --spacing-128: 32rem;

  /* Custom shadows */
  --shadow-soft: 0 2px 15px -3px rgba(0, 0, 0, 0.07), ...;
  --shadow-card: 0 0 0 1px rgba(0, 0, 0, 0.05), ...;

  /* Custom animations */
  --animate-slide-in: slideIn 0.2s ease-out;
  --animate-fade-in: fadeIn 0.2s ease-out;
}
```

### CSS Variables for Light/Dark Mode

HSL-based CSS variables enable theme switching:

```css
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 199 89% 48%;
    --destructive: 0 84.2% 60.2%;
    /* ... */
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 199 89% 48%;
    /* ... */
  }
}
```

Usage in components:

```tsx
<div className="bg-background text-foreground">
  <button className="bg-primary text-primary-foreground">Click me</button>
</div>
```

---

## CVA Components

### Available Components

| Component | Path                       | Variants               |
| --------- | -------------------------- | ---------------------- |
| Button    | `components/ui/Button.tsx` | `variant`, `size`      |
| Input     | `components/ui/Input.tsx`  | `variant`, `inputSize` |
| Label     | `components/ui/Label.tsx`  | `variant`              |
| Badge     | `components/ui/Badge.tsx`  | `variant`              |
| Card      | `components/ui/Card.tsx`   | Compound components    |
| Table     | `components/ui/Table.tsx`  | Compound components    |

### Button Variants

```tsx
import { Button } from '@/components/ui';

// Variants
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="outline">Outline</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>
<Button size="icon"><IconComponent /></Button>

// With custom classes
<Button variant="primary" className="w-full">Full Width</Button>
```

### Input Variants

```tsx
import { Input } from '@/components/ui';

// Basic
<Input placeholder="Enter text" />

// With label and error
<Input
  label="Email"
  error="Invalid email address"
  variant="error"
/>

// With prefix/suffix
<Input
  prefix={<SearchIcon />}
  suffix={<ClearButton />}
/>

// Sizes
<Input inputSize="sm" />
<Input inputSize="default" />
<Input inputSize="lg" />
```

### Badge Variants

```tsx
import { Badge } from '@/components/ui';

<Badge variant="default">Default</Badge>
<Badge variant="primary">Primary</Badge>
<Badge variant="success">Success</Badge>
<Badge variant="warning">Warning</Badge>
<Badge variant="danger">Danger</Badge>
<Badge variant="outline">Outline</Badge>
```

### Card Components

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description text</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card content goes here</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>;
```

### Table Components

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui';

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>John Doe</TableCell>
      <TableCell>
        <Badge variant="success">Active</Badge>
      </TableCell>
      <TableCell className="text-right">$100.00</TableCell>
    </TableRow>
  </TableBody>
</Table>;
```

---

## The `cn()` Utility

The `cn()` function combines `clsx` and `tailwind-merge`:

```typescript
// lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const customTwMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        /* custom colors */
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
```

### Usage

```tsx
import { cn } from '@/lib/utils';

// Conditional classes
<div className={cn(
  'base-class',
  isActive && 'active-class',
  isDisabled && 'opacity-50 cursor-not-allowed'
)}>

// Merging with overrides
<Button className={cn('w-full', className)}>

// Array syntax
<div className={cn([
  'flex items-center',
  variant === 'large' && 'text-lg',
  className
])}>
```

---

## Creating New Components

### Step 1: Define Variants with CVA

```tsx
// components/ui/Alert.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  // Base styles
  'relative w-full rounded-lg border p-4',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        info: 'bg-primary-50 border-primary-200 text-primary-800',
        success: 'bg-success-50 border-green-200 text-success-700',
        warning: 'bg-warning-50 border-yellow-200 text-warning-700',
        error: 'bg-danger-50 border-red-200 text-danger-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);
```

### Step 2: Create the Component

```tsx
export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  title?: string;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, title, children, ...props }, ref) => (
    <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {title && <h5 className="mb-1 font-medium">{title}</h5>}
      <div className="text-sm">{children}</div>
    </div>
  )
);

Alert.displayName = 'Alert';

export { Alert, alertVariants };
```

### Step 3: Export from Index

```tsx
// components/ui/index.ts
export { Alert, alertVariants, type AlertProps } from './Alert';
```

---

## Best Practices

### ✅ Do

1. **Use CVA for variant-based components**

   ```tsx
   const variants = cva('base', { variants: { size: { sm: '...', lg: '...' } } });
   ```

2. **Use `cn()` for class merging**

   ```tsx
   <div className={cn(baseClasses, conditionalClass, className)} />
   ```

3. **Forward refs for DOM elements**

   ```tsx
   const Button = React.forwardRef<HTMLButtonElement, Props>((props, ref) => ...);
   ```

4. **Export variant types for consumers**

   ```tsx
   export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
   ```

5. **Use semantic color names**
   ```tsx
   <div className="bg-success-50 text-success-700" /> // ✅
   <div className="bg-green-50 text-green-700" />     // ❌
   ```

### ❌ Don't

1. **Don't use `@apply` directives** (migrated to CVA)

   ```css
   /* ❌ Avoid */
   .btn-primary {
     @apply bg-primary-500 text-white;
   }
   ```

2. **Don't create CSS class utilities** (use Tailwind directly)

   ```css
   /* ❌ Avoid */
   .text-large { font-size: 1.25rem; }

   /* ✅ Use Tailwind */
   <span className="text-xl">
   ```

3. **Don't hardcode colors** (use theme variables)

   ```tsx
   <div className="bg-[#0ea5e9]" />  // ❌
   <div className="bg-primary-500" /> // ✅
   ```

4. **Don't mix styling approaches** (pick one per component)

   ```tsx
   // ❌ Mixed
   <div style={{ padding: '10px' }} className="bg-white" />

   // ✅ Consistent
   <div className="p-2.5 bg-white" />
   ```

---

## Migration Notes

### From Tailwind v3

The project was migrated from Tailwind CSS v3 to v4 with the following changes:

| Before (v3)                                                  | After (v4)                  |
| ------------------------------------------------------------ | --------------------------- |
| `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";`    |
| `tailwind.config.js`                                         | `@theme { }` block in CSS   |
| `postcss.config.js`                                          | Removed (using Vite plugin) |
| `theme()` function                                           | CSS variables               |
| `@apply` directives                                          | CVA components              |

### From `@apply` to CVA

Old approach (CSS classes with `@apply`):

```css
.btn-primary {
  @apply bg-primary-500 text-white px-4 py-2 rounded;
}
```

New approach (CVA components):

```tsx
const buttonVariants = cva('px-4 py-2 rounded', {
  variants: {
    variant: {
      primary: 'bg-primary-500 text-white',
    },
  },
});
```

### Updated tailwind-merge Configuration

tailwind-merge v3 changed the configuration API:

```typescript
// v2 (old)
extendTailwindMerge({
  theme: { colors: ['primary-500', ...] }
})

// v3 (new)
extendTailwindMerge({
  extend: {
    theme: { color: ['primary-500', ...] }  // Note: 'color' not 'colors'
  }
})
```

---

## Quick Reference

### File Locations

| Purpose             | File                                     |
| ------------------- | ---------------------------------------- |
| Theme configuration | `apps/web/src/index.css`                 |
| Class merge utility | `apps/web/src/lib/utils.ts`              |
| UI primitives       | `apps/web/src/components/ui/`            |
| Form controls       | `apps/web/src/components/form-controls/` |

### Import Patterns

```tsx
// UI primitives
import { Button, Input, Card, Badge, Table } from '@/components/ui';

// Utility function
import { cn } from '@/lib/utils';

// CVA (if creating custom variants)
import { cva, type VariantProps } from 'class-variance-authority';
```

### Color Palette Quick Reference

| Prefix        | Usage                         |
| ------------- | ----------------------------- |
| `primary-*`   | Brand colors, primary actions |
| `secondary-*` | Secondary UI elements         |
| `success-*`   | Success states, confirmations |
| `warning-*`   | Warnings, cautions            |
| `danger-*`    | Errors, destructive actions   |
| `muted-*`     | Disabled, placeholder text    |

---

## Need Help?

1. Check existing components in `components/ui/` for patterns
2. Reference the CVA documentation: https://cva.style/docs
3. Review Tailwind v4 docs: https://tailwindcss.com/docs
4. Ask questions in project Discussions
