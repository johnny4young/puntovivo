/**
 * EmptyState (receta `.pv-empty`, propuesta §16).
 *
 * Estado vacío ÚNICO del sistema: glifo tonal dentro del contenedor `.ic`
 * (46px), título corto, una frase imperativa de descripción y una acción /
 * CTA opcional. Sin ilustraciones. Envuelve la receta tokenizada `.pv-empty`
 * definida en components.css () para que toda pantalla con cero filas
 * (periféricos, fiscal sin migrar, búsquedas sin resultados, etc.) se vea
 * idéntica en glifo, tipografía, márgenes y borde punteado.
 *
 * La acción se pasa como slot (`ReactNode`) en vez de props de botón porque
 * el CTA varía por pantalla: a veces es un `Button` con un handler tRPC y a
 * veces un enlace de navegación con `buttonVariants`. El caller construye el
 * control tipado con su lógica y lo entrega aquí ya cableado.
 *
 * @module components/feedback/EmptyState
 */
import type { ElementType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /**
   * Glifo tonal: componente de icono lucide (p. ej. `Printer`, `Landmark`).
   * Se renderiza dentro del contenedor `.ic` con el tamaño por defecto de
   * lucide, igual que el target §16.
   */
  icon: ElementType;
  /** Título corto del estado vacío (una línea, sentence case). */
  title: string;
  /**
   * Descripción imperativa de una frase que indica el siguiente paso
   * (p. ej. "Agrega una impresora para que esta sede la reconozca").
   */
  description: string;
  /**
   * Acción / CTA opcional. El caller pasa su propio `Button` o enlace con
   * `buttonVariants`, ya cableado a su handler o navegación. Se omite cuando
   * el estado vacío es puramente informativo.
   */
  action?: ReactNode;
  /** Clases extra para el contenedor `.pv-empty`. */
  className?: string | undefined;
}

/**
 * Renderiza la receta `.pv-empty` con glifo + título + descripción y un slot
 * de acción opcional. No formatea texto: el caller pasa cadenas ya traducidas
 * vía i18n.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('pv-empty', className)}>
      <span className="ic">
        <Icon aria-hidden="true" />
      </span>
      <h4>{title}</h4>
      <p>{description}</p>
      {action}
    </div>
  );
}
