import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/brand/BrandMark';
import { cn } from '@/lib/utils';

export function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation('nav');
  // +  — Puntovivo BrandMark + the "punto" 400 / "vivo"
  // 700 lowercase wordmark in Inter (primary) per the design specification
  // shell.jsx lockup. The orange punto accent is visible in both
  // expanded and collapsed rail; the tagline only renders expanded.
  return (
    <div
      className={cn('flex items-center gap-2.5 px-2 py-1.5', collapsed && 'justify-center px-0')}
    >
      <BrandMark
        className="h-9 w-9 shrink-0 drop-shadow-[0_8px_18px_color-mix(in_oklch,var(--primary)_45%,transparent)]"
        label={t('brand.title', 'Puntovivo')}
      />
      {!collapsed && (
        <div className="min-w-0 leading-none">
          <p className="text-[0.55rem] font-semibold uppercase tracking-[0.22em] text-primary-700">
            {t('brand.tagline')}
          </p>
          <h1 className="mt-1 truncate text-lg leading-none tracking-[-0.01em] text-primary lowercase">
            <span className="font-normal">punto</span>
            <span className="font-bold">vivo</span>
          </h1>
        </div>
      )}
    </div>
  );
}
