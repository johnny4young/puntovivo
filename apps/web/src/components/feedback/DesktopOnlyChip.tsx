/**
 * Rediseño FASE 3 — DesktopOnlyChip + DisabledControl (receta
 * `.pv-chip-desktop` / `.pv-disabled`, propuesta §16).
 *
 * Patrón ÚNICO para los controles que solo existen en la app Electron
 * (bandeja, impresión silenciosa, respaldos, actualizador). Hoy cuatro
 * paneles de Localización repiten la misma frase larga en recuadros grises
 * con checkboxes apagados sin estilo; el target §16 unifica todo en:
 *
 *   1. un chip `.pv-chip-desktop` ("Solo escritorio" + glifo Monitor) en el
 *      encabezado de la sección, y
 *   2. el control asociado atenuado de forma consistente (`.pv-disabled`:
 *      sin hover, sin foco, `aria-disabled`), con UNA sola línea de
 *      explicación que aporta el caller.
 *
 * Este módulo expone las dos piezas como átomos para que cada panel las
 * componga sin duplicar markup. La línea de ayuda NO vive aquí: su texto
 * cambia por panel (impresión / actualizador / respaldo / bandeja), así que
 * el caller la renderiza como su propio `<p>` junto al chip.
 *
 * @module components/feedback/DesktopOnlyChip
 */
import type { ReactNode } from 'react';
import { Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export interface DesktopOnlyChipProps {
  /**
   * Etiqueta del chip. Por defecto usa la key `common:desktopOnly.label`
   * ("Solo escritorio"). Pasa un valor solo si un panel necesita una
   * variante; en general déjalo en su default para mantener consistencia.
   */
  label?: string;
  /** Clases extra para el chip `.pv-chip-desktop`. */
  className?: string | undefined;
}

/**
 * Chip de entorno "Solo escritorio" con glifo Monitor. Se coloca en el
 * encabezado del panel (al lado del título, dentro de un layout `.between`).
 */
export function DesktopOnlyChip({ label, className }: DesktopOnlyChipProps) {
  const { t } = useTranslation('common');
  return (
    <span className={cn('pv-chip-desktop', className)}>
      <Monitor className="h-[11px] w-[11px]" aria-hidden="true" />
      {label ?? t('desktopOnly.label')}
    </span>
  );
}

export interface DisabledControlProps {
  /** El control (checkboxes, botón, grupo de campos) que queda atenuado. */
  children: ReactNode;
  /** Clases extra para el contenedor `.pv-disabled`. */
  className?: string | undefined;
}

/**
 * Envuelve un control que debe verse atenuado por entorno (no disponible en
 * web). Aplica la receta `.pv-disabled` (opacidad reducida + `pointer-events:
 * none`, sin hover) y marca `aria-disabled` para que la tecnología de apoyo
 * anuncie el estado deshabilitado de forma consistente con el target §16.
 *
 * Úsalo junto a {@link DesktopOnlyChip}: el chip comunica el porqué en el
 * encabezado y este wrapper atenúa el control asociado.
 */
export function DisabledControl({ children, className }: DisabledControlProps) {
  return (
    <div className={cn('pv-disabled', className)} aria-disabled="true">
      {children}
    </div>
  );
}
