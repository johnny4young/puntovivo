/**
 * ENG-069 — KDS home placeholder. Replaced by the real kitchen
 * ticket queue UI in ENG-039.
 *
 * Uses a slightly different card style — light card on the dark
 * KDS backdrop — so the placeholder remains legible until the
 * real ticket queue lands.
 */
import { SurfacePlaceholder } from './SurfacePlaceholder';

export function KdsHomePlaceholder() {
  return (
    <SurfacePlaceholder
      i18nKey="kds"
      containerClassName="flex min-h-[60vh] items-center justify-center"
      cardClassName="flex max-w-lg flex-col gap-4 rounded-3xl bg-secondary-50 p-8 text-center text-secondary-950"
    />
  );
}
