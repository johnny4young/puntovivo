import { type ReactNode } from 'react';

interface ProductFormFieldGroupProps {
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * Subtitled field group used to organize the General tab into the three
 * documented sections (Identity · Classification · Inventory). Renders an
 * <h4> heading plus a muted one-line description above the grouped fields.
 */
export function ProductFormFieldGroup({ title, description, children }: ProductFormFieldGroupProps) {
  return (
    <section className="space-y-4">
      <div className="space-y-0.5">
        <h4 className="font-display text-lg leading-tight text-secondary-950">{title}</h4>
        <p className="text-sm text-secondary-500">{description}</p>
      </div>
      {children}
    </section>
  );
}
