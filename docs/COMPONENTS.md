# Components Guide

> **For New Collaborators**: This document provides an overview of all available UI components and how to use them effectively.

---

## Table of Contents

1. [Component Organization](#component-organization)
2. [UI Primitives](#ui-primitives)
3. [Form Controls](#form-controls)
4. [Layout Components](#layout-components)
5. [Table Components](#table-components)
6. [Feature Components](#feature-components)
7. [Component Conventions](#component-conventions)

---

## Component Organization

```
apps/web/src/components/
├── ui/                   # 🎨 Primitive UI components (generic, reusable)
│   ├── Button.tsx        # Buttons with variants
│   ├── Input.tsx         # Text inputs with validation states
│   ├── Label.tsx         # Form labels
│   ├── Badge.tsx         # Status badges
│   ├── Card.tsx          # Card containers
│   ├── Table.tsx         # Table elements
│   └── index.ts          # Barrel export
│
├── form-controls/        # 📝 Complex form components (business logic)
│   ├── Select.tsx        # Dropdown select
│   ├── Checkbox.tsx      # Checkbox input
│   ├── DatePicker.tsx    # Date selection
│   ├── FormField.tsx     # Form field wrapper
│   ├── Modal.tsx         # Modal dialogs
│   └── index.ts
│
├── layout/               # 📐 Layout components
│   └── ...
│
└── tables/               # 📊 Data table components
    └── DataTable.tsx     # Full-featured data table
```

### Import Patterns

```tsx
// Primitives (generic UI elements)
import { Button, Input, Badge, Card, Table } from '@/components/ui';

// Form controls (complex inputs)
import { Select, Checkbox, DatePicker, Modal } from '@/components/form-controls';

// Tables
import { DataTable } from '@/components/tables';

// Utility
import { cn } from '@/lib/utils';
```

---

## UI Primitives

### Button

A flexible button component with multiple variants and sizes.

```tsx
import { Button } from '@/components/ui';
```

#### Variants

| Variant       | Description         | Use Case          |
| ------------- | ------------------- | ----------------- |
| `primary`     | Solid primary color | Main actions      |
| `secondary`   | Muted background    | Secondary actions |
| `outline`     | Border only         | Tertiary actions  |
| `ghost`       | Transparent         | Subtle actions    |
| `destructive` | Red/danger color    | Delete, remove    |
| `link`        | Text with underline | Navigation        |

#### Sizes

| Size      | Height  | Use Case            |
| --------- | ------- | ------------------- |
| `sm`      | 32px    | Compact UIs, tables |
| `default` | 40px    | Standard buttons    |
| `lg`      | 48px    | Hero sections, CTAs |
| `icon`    | 40x40px | Icon-only buttons   |

#### Examples

```tsx
// Basic usage
<Button>Click Me</Button>

// With variants
<Button variant="primary">Save</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="destructive">Delete</Button>

// With sizes
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>

// With icons
<Button size="icon"><PlusIcon /></Button>
<Button><PlusIcon className="mr-2" /> Add Item</Button>

// Disabled state
<Button disabled>Disabled</Button>

// Loading state (custom)
<Button disabled>
  <SpinnerIcon className="mr-2 animate-spin" />
  Loading...
</Button>

// Full width
<Button className="w-full">Full Width Button</Button>

// As link (using asChild pattern)
<Button asChild>
  <a href="/page">Go to Page</a>
</Button>
```

---

### Input

A text input component with label, error states, and prefix/suffix support.

```tsx
import { Input } from '@/components/ui';
```

#### Props

| Prop        | Type                        | Description               |
| ----------- | --------------------------- | ------------------------- |
| `label`     | `string`                    | Label text above input    |
| `error`     | `string`                    | Error message below input |
| `variant`   | `'default' \| 'error'`      | Visual variant            |
| `inputSize` | `'sm' \| 'default' \| 'lg'` | Size variant              |
| `prefix`    | `ReactNode`                 | Element before input      |
| `suffix`    | `ReactNode`                 | Element after input       |

#### Examples

```tsx
// Basic usage
<Input placeholder="Enter your name" />

// With label
<Input label="Email" type="email" placeholder="you@example.com" />

// With error state
<Input
  label="Password"
  type="password"
  error="Password must be at least 8 characters"
  variant="error"
/>

// With prefix/suffix
<Input
  prefix={<SearchIcon className="h-4 w-4 text-muted-foreground" />}
  placeholder="Search..."
/>

<Input
  type="number"
  suffix={<span className="text-muted-foreground">USD</span>}
/>

// Different sizes
<Input inputSize="sm" placeholder="Small" />
<Input inputSize="lg" placeholder="Large" />

// Controlled input
const [value, setValue] = useState('');
<Input value={value} onChange={(e) => setValue(e.target.value)} />
```

---

### Label

A label component for form inputs.

```tsx
import { Label } from '@/components/ui';
```

#### Variants

| Variant    | Description          |
| ---------- | -------------------- |
| `default`  | Standard label       |
| `error`    | Red color for errors |
| `disabled` | Muted color          |
| `muted`    | Subtle text          |

#### Examples

```tsx
// Basic usage
<Label htmlFor="email">Email</Label>
<input id="email" type="email" />

// With error variant
<Label htmlFor="password" variant="error">Password (required)</Label>

// With required indicator
<Label>
  Email <span className="text-danger-500">*</span>
</Label>
```

---

### Badge

A component for displaying status or category information.

```tsx
import { Badge } from '@/components/ui';
```

#### Variants

| Variant     | Color       | Use Case         |
| ----------- | ----------- | ---------------- |
| `default`   | Gray        | Neutral status   |
| `primary`   | Blue        | Primary category |
| `secondary` | Gray        | Secondary info   |
| `success`   | Green       | Success, active  |
| `warning`   | Yellow      | Caution, pending |
| `danger`    | Red         | Error, inactive  |
| `outline`   | Border only | Subtle indicator |

#### Examples

```tsx
// Status badges
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>
<Badge variant="danger">Inactive</Badge>

// Category badges
<Badge variant="primary">Electronics</Badge>
<Badge variant="secondary">Accessories</Badge>

// In a table cell
<TableCell>
  {product.inStock ? (
    <Badge variant="success">In Stock</Badge>
  ) : (
    <Badge variant="danger">Out of Stock</Badge>
  )}
</TableCell>

// Multiple badges
<div className="flex gap-2">
  <Badge variant="primary">Featured</Badge>
  <Badge variant="outline">New</Badge>
</div>
```

---

### Card

A container component for grouping related content.

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui';
```

#### Components

| Component         | Purpose              |
| ----------------- | -------------------- |
| `Card`            | Container wrapper    |
| `CardHeader`      | Header section       |
| `CardTitle`       | Main heading         |
| `CardDescription` | Subtitle/description |
| `CardContent`     | Main content area    |
| `CardFooter`      | Footer with actions  |

#### Examples

```tsx
// Basic card
<Card>
  <CardContent className="pt-6">
    <p>Simple card content</p>
  </CardContent>
</Card>

// Full card structure
<Card>
  <CardHeader>
    <CardTitle>Product Details</CardTitle>
    <CardDescription>View and edit product information</CardDescription>
  </CardHeader>
  <CardContent>
    <form>
      <Input label="Product Name" />
      <Input label="Price" type="number" />
    </form>
  </CardContent>
  <CardFooter className="flex justify-end gap-2">
    <Button variant="outline">Cancel</Button>
    <Button>Save</Button>
  </CardFooter>
</Card>

// Dashboard stat card
<Card>
  <CardHeader className="flex flex-row items-center justify-between pb-2">
    <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
    <DollarIcon className="h-4 w-4 text-muted-foreground" />
  </CardHeader>
  <CardContent>
    <div className="text-2xl font-bold">$45,231.89</div>
    <p className="text-xs text-muted-foreground">+20.1% from last month</p>
  </CardContent>
</Card>
```

---

### Table

Semantic table components for displaying tabular data.

```tsx
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui';
```

#### Components

| Component      | HTML Element | Purpose         |
| -------------- | ------------ | --------------- |
| `Table`        | `<table>`    | Table container |
| `TableHeader`  | `<thead>`    | Header section  |
| `TableBody`    | `<tbody>`    | Body section    |
| `TableFooter`  | `<tfoot>`    | Footer section  |
| `TableRow`     | `<tr>`       | Table row       |
| `TableHead`    | `<th>`       | Header cell     |
| `TableCell`    | `<td>`       | Body cell       |
| `TableCaption` | `<caption>`  | Table caption   |

#### Examples

```tsx
// Basic table
<Table>
  <TableCaption>A list of recent invoices</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead>Invoice</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Method</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {invoices.map((invoice) => (
      <TableRow key={invoice.id}>
        <TableCell className="font-medium">{invoice.number}</TableCell>
        <TableCell>
          <Badge variant={invoice.status === 'paid' ? 'success' : 'warning'}>
            {invoice.status}
          </Badge>
        </TableCell>
        <TableCell>{invoice.method}</TableCell>
        <TableCell className="text-right">${invoice.amount}</TableCell>
      </TableRow>
    ))}
  </TableBody>
  <TableFooter>
    <TableRow>
      <TableCell colSpan={3}>Total</TableCell>
      <TableCell className="text-right">${total}</TableCell>
    </TableRow>
  </TableFooter>
</Table>

// With actions column
<TableCell>
  <div className="flex gap-2">
    <Button size="sm" variant="ghost">Edit</Button>
    <Button size="sm" variant="ghost" className="text-danger-500">Delete</Button>
  </div>
</TableCell>

// Clickable rows
<TableRow
  className="cursor-pointer hover:bg-muted/50"
  onClick={() => handleRowClick(item.id)}
>
  ...
</TableRow>
```

---

## Form Controls

### Select

A dropdown select component (located in `form-controls/`).

```tsx
import { Select } from '@/components/form-controls';

<Select
  label="Category"
  options={[
    { value: 'electronics', label: 'Electronics' },
    { value: 'clothing', label: 'Clothing' },
  ]}
  value={category}
  onChange={setCategory}
/>;
```

### Checkbox

A checkbox input component.

```tsx
import { Checkbox } from '@/components/form-controls';

<Checkbox label="Accept terms and conditions" checked={accepted} onChange={setAccepted} />;
```

### DatePicker

A date selection component.

```tsx
import { DatePicker } from '@/components/form-controls';

<DatePicker label="Start Date" value={startDate} onChange={setStartDate} />;
```

### Modal

A modal dialog component.

```tsx
import { Modal } from '@/components/form-controls';

<Modal open={isOpen} onClose={() => setIsOpen(false)} title="Confirm Delete">
  <p>Are you sure you want to delete this item?</p>
  <div className="flex justify-end gap-2 mt-4">
    <Button variant="outline" onClick={() => setIsOpen(false)}>
      Cancel
    </Button>
    <Button variant="destructive" onClick={handleDelete}>
      Delete
    </Button>
  </div>
</Modal>;
```

---

## Component Conventions

### Naming

- **Files**: PascalCase matching component name (`Button.tsx`)
- **Components**: PascalCase (`Button`, `CardHeader`)
- **Variants**: camelCase (`buttonVariants`, `inputVariants`)
- **Props interfaces**: ComponentName + Props (`ButtonProps`, `InputProps`)

### Props Pattern

All components should:

1. Extend native HTML element props
2. Include CVA variant props (if applicable)
3. Support `className` override via `cn()`
4. Forward refs to DOM elements

```tsx
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
```

### Export Pattern

Each component file should export:

1. The component itself
2. The variants function (for extending)
3. The props type

```tsx
export { Button, buttonVariants, type ButtonProps };
```

Barrel exports in `index.ts`:

```tsx
export { Button, buttonVariants, type ButtonProps } from './Button';
export { Input, inputVariants, type InputProps } from './Input';
// ...
```

---

## Adding New Components

1. **Create the component file** in the appropriate folder
2. **Define variants** using CVA (if needed)
3. **Implement the component** following conventions
4. **Export from index.ts**
5. **Document usage** in this guide

See [docs/STYLING.md](./STYLING.md) for detailed CVA patterns and styling guidelines.
