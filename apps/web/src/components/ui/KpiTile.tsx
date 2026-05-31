/**
 * Rediseño FASE 2 — KpiTile (receta `.pv-kpi`, propuesta §03/§04).
 *
 * Receta ÚNICA de métrica compartida por Dashboard, Inventario, Operations
 * y POS, para que los cuatro grupos de KPIs se vean idénticos en altura,
 * glifo, tipografía y alineación numérica. Envuelve las clases tokenizadas
 * `pv-kpi` / `pv-gt-*` definidas en components.css (FASE 0); el caller solo
 * pasa datos ya formateados.
 *
 * @module components/ui/KpiTile
 */
import { memo, type ElementType } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Tono semántico del glifo tonal. */
export type KpiTone = 'primary' | 'success' | 'warning' | 'danger' | 'ink';

const KPI_TONE_CLASS: Record<KpiTone, string> = {
  primary: 'pv-gt-primary',
  success: 'pv-gt-success',
  warning: 'pv-gt-warning',
  danger: 'pv-gt-danger',
  ink: 'pv-gt-ink',
};

/**
 * Variación opcional (delta) mostrada antes de la línea de contexto.
 * `direction` controla el color (up=success, down=danger) y la flecha.
 */
export interface KpiDelta {
  direction: 'up' | 'down';
  label: string;
}

export interface KpiTileProps {
  /** Glifo tonal (componente de icono lucide). */
  icon: ElementType;
  /** Microetiqueta en mayúsculas sobre la cifra. */
  label: string;
  /** Cifra principal, ya formateada por el caller. */
  value: string;
  /** Línea de contexto bajo la cifra. */
  context?: string | undefined;
  /** Tono del glifo (default `primary`). Stock bajo / fallos usan `danger`. */
  tone?: KpiTone | undefined;
  /** Render de la cifra en mono tabular — úsalo para montos de dinero. */
  mono?: boolean | undefined;
  /** Delta opcional de variación. */
  delta?: KpiDelta | undefined;
  className?: string | undefined;
}

export const KpiTile = memo(function KpiTile({
  icon: Icon,
  label,
  value,
  context,
  tone = 'primary',
  mono = false,
  delta,
  className,
}: KpiTileProps) {
  return (
    <div className={cn('pv-kpi', className)}>
      <div className="hd">
        <span className={cn('pv-gt', KPI_TONE_CLASS[tone])}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="lbl">{label}</span>
      </div>
      <div className={cn('val', mono && 'mono')}>{value}</div>
      {(delta || context) && (
        <div className="sub">
          {delta && (
            <span className={cn('delta', delta.direction)}>
              {delta.direction === 'up' ? (
                <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
              )}
              {delta.label}
            </span>
          )}
          {context && <span>{context}</span>}
        </div>
      )}
    </div>
  );
});
