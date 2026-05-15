import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';

interface BrandLogoProps {
  className?: string;
  /**
   * Hide the tagline ("Consola Retail"). Useful when the lockup sits next
   * to a page-kicker that already supplies context, so the tagline would
   * just repeat noise.
   */
  hideTagline?: boolean;
  /**
   * Render in a compact two-line stack (mark above wordmark) instead of
   * the default horizontal lockup. Falls back to horizontal at the call
   * site via utility classes when responsive switching is needed.
   */
  variant?: 'horizontal' | 'stacked';
}

/**
 * Full Puntovivo lockup — mark + serif wordmark + uppercase tagline.
 *
 * Used in the LoginPage hero and the header brand cluster. The mark
 * carries the brand accent dot via BrandMark; the tagline picks up
 * `nav:brand.tagline` from i18n so en/es stay parity-correct.
 */
export function BrandLogo({ className, hideTagline, variant = 'horizontal' }: BrandLogoProps) {
  const { t } = useTranslation('nav');
  const stacked = variant === 'stacked';
  return (
    <div
      className={cn(
        'flex items-center gap-3',
        stacked && 'flex-col items-start gap-2',
        className
      )}
    >
      <BrandMark className="h-11 w-11" label={t('brand.title', 'Puntovivo')} />
      <div className="flex flex-col leading-none">
        <span className="font-display text-2xl tracking-[-0.025em] text-secondary-950">
          {t('brand.title', 'Puntovivo')}
        </span>
        {!hideTagline && (
          <span className="mt-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.3em] text-primary-600">
            {t('brand.tagline')}
          </span>
        )}
      </div>
    </div>
  );
}
