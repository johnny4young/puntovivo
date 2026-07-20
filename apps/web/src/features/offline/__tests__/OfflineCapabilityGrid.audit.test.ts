/**
 * Offline-capability tile catalog audit.
 *
 * Pins the contract from `OfflineCapabilityGrid` so a casual edit
 * cannot land a marketing overstatement silently:
 *
 * - Catalog cardinality (exactly 6 tiles today). Adding a 7th
 * requires updating the capability catalog in the same commit
 * (enforced by review).
 * - Tile ids belong to the closed set known to the capability catalog.
 * - Each tile uses a valid `status` from the closed enum.
 * - Every `status='available'` tile maps to a documented backing
 * feature (the test carries a hardcoded reference matrix that
 * serves as living documentation).
 * - `limited` / `pending` / `blocked` tiles never use absolute
 * language in their note copy (en + es).
 *
 * @module features/offline/__tests__/OfflineCapabilityGrid.audit.test
 */
import { describe, expect, it } from 'vitest';
import enCommon from '@/i18n/locales/en/common.json';
import esCommon from '@/i18n/locales/es/common.json';
import {
  OFFLINE_CAPABILITY_CATALOG,
  type OfflineCapabilityStatus,
} from '../OfflineCapabilityCatalog';

const KNOWN_TILE_IDS = new Set(['sell', 'cash', 'card', 'receipt', 'loyalty', 'inventory']);

const VALID_STATUSES: ReadonlySet<OfflineCapabilityStatus> = new Set([
  'available',
  'limited',
  'pending',
  'blocked',
] as const);

/**
 * Living documentation: each `'available'` tile must point at a
 * shipped feature that delivers the offline behavior. Updating this
 * map is part of the contract — adding a new `available` tile
 * without naming its backing feature fails the test.
 */
const AVAILABLE_TILE_BACKING_FEATURE: Readonly<Record<string, string>> = {
  // ships the local product cache that lets the cashier
  // search SKU / barcode / name without server reachability.
  sell: ' local product cache',
  // +  let the cashier complete a cash (or split
  // cash + credit) sale entirely offline — local sale row + cash
  // movement + sync_outbox queued for drain on reconnect.
  cash: ' +  offline sale completion',
};

const ABSOLUTE_LANGUAGE_FORBIDDEN = [
  /\b100%\b/i,
  /\bsiempre\b/i,
  /\balways\b/i,
  /\btotalmente\b/i,
  /\btotally\b/i,
  /\bcompletamente\b/i,
  /\bfully\b/i,
];

interface OfflineGridCapabilityCopy {
  label: string;
  note: string;
}

interface OfflineGridLocale {
  offlineGrid: {
    capabilities: Record<string, OfflineGridCapabilityCopy>;
  };
}

function getCapabilityCopy(locale: 'en' | 'es', id: string): OfflineGridCapabilityCopy | undefined {
  const bundle = (locale === 'en' ? enCommon : esCommon) as unknown as OfflineGridLocale;
  return bundle.offlineGrid?.capabilities?.[id];
}

describe('OfflineCapabilityGrid catalog audit', () => {
  it('exposes exactly 6 tiles — any change requires updating the capability catalog', () => {
    expect(OFFLINE_CAPABILITY_CATALOG).toHaveLength(6);
  });

  it('every tile id is in the known set documented in the capability catalog', () => {
    for (const tile of OFFLINE_CAPABILITY_CATALOG) {
      expect(KNOWN_TILE_IDS.has(tile.id)).toBe(true);
    }
  });

  it('every tile uses a status from the closed enum', () => {
    for (const tile of OFFLINE_CAPABILITY_CATALOG) {
      expect(VALID_STATUSES.has(tile.status)).toBe(true);
    }
  });

  it('every status=available tile is documented as backed by a shipped feature', () => {
    for (const tile of OFFLINE_CAPABILITY_CATALOG) {
      if (tile.status !== 'available') continue;
      const backing = AVAILABLE_TILE_BACKING_FEATURE[tile.id];
      expect(
        backing,
        `Tile "${tile.id}" is status=available but has no backing-feature reference. ` +
          'Add it to AVAILABLE_TILE_BACKING_FEATURE in this test, or change the status.'
      ).toBeTruthy();
    }
  });

  it('limited / pending / blocked tile copy never uses absolute language', () => {
    for (const tile of OFFLINE_CAPABILITY_CATALOG) {
      if (tile.status === 'available') continue;
      for (const locale of ['en', 'es'] as const) {
        const copy = getCapabilityCopy(locale, tile.id);
        expect(copy, `Missing ${locale} copy for tile "${tile.id}"`).toBeDefined();
        const text = `${copy?.label ?? ''} ${copy?.note ?? ''}`;
        for (const pattern of ABSOLUTE_LANGUAGE_FORBIDDEN) {
          expect(
            pattern.test(text),
            `Tile "${tile.id}" (status=${tile.status}, locale=${locale}) ` +
              `uses absolute language matching ${pattern} — overstatement risk. ` +
              `Copy: "${text.trim()}"`
          ).toBe(false);
        }
      }
    }
  });

  it('every tile has en + es i18n copy under offlineGrid.capabilities.<id>', () => {
    for (const tile of OFFLINE_CAPABILITY_CATALOG) {
      const en = getCapabilityCopy('en', tile.id);
      const es = getCapabilityCopy('es', tile.id);
      // Label is always rendered.
      expect(en?.label, `en label for "${tile.id}"`).toBeTruthy();
      expect(es?.label, `es label for "${tile.id}"`).toBeTruthy();
      // The render path guards the note row on `cap.note` (the catalog
      // flag), so the note translation is only required when the tile
      // declares one. Tiles with no `note` field render label-only.
      if (tile.note !== undefined) {
        expect(en?.note, `en note for "${tile.id}"`).toBeTruthy();
        expect(es?.note, `es note for "${tile.id}"`).toBeTruthy();
      }
    }
  });
});
