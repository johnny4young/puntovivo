/**
 * Every money-writing modal routes its submit through the in-flight guard.
 *
 * `Modal` renders `footer` as a SIBLING of `children`. A modal whose body is a
 * `<form>` therefore keeps its confirm button OUTSIDE that form, and
 * `disabled={isSaving}` on the button guards the click path only. A submit
 * event dispatched at the form — implicit submission from Enter, an explicit
 * `requestSubmit()`, or a submit button someone adds inside the form later —
 * never consults it. Held Enter on a repeating keyboard is not a race but a
 * loop: on `customerLedger.addPayment` it pays the customer's debt down once
 * per repeat, from one gesture.
 *
 * This is a SOURCE scan, and it is deliberate. The per-modal behavioural tests
 * prove the guard works in the modals that have one; only a scan can fail when
 * somebody adds an ELEVENTH money modal with the same shape and no test at
 * all. jsdom implements no implicit form submission whatsoever (verified: a
 * form with one blocking field and no submit button receives zero submit
 * events from Enter), so no component test can prove reachability either —
 * which is exactly why the structural rule has to carry that weight.
 *
 * Adding a form-bearing modal that takes `isSaving` means choosing a bucket
 * below. That choice is the review moment this file exists to force.
 *
 * @module features/__tests__/money-modal-submit-guard.test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

// Vitest runs with the workspace root as cwd; `import.meta.url` is not a file
// URL under the jsdom environment, so resolve from cwd the way the other
// source-scanning tests in this workspace do.
const SRC_DIR = path.resolve(process.cwd(), 'src');
const FEATURES_DIR = path.join(SRC_DIR, 'features');

/** Money writes. Every `form.handleSubmit` here wraps `useSingleFlightSubmit`. */
const GUARDED_BY_HOOK: Record<string, number> = {
  'features/customers/CustomerLedgerAbonoModal.tsx': 1,
  'features/inventory/InventoryAdjustmentModal.tsx': 1,
  'features/inventory/InventoryEntryModal.tsx': 1,
  'features/orders/OrderFinalizeModal.tsx': 1,
  'features/orders/OrderReceiveModal.tsx': 1,
  'features/purchases/PurchaseFinalizeModal.tsx': 1,
  'features/purchases/PurchaseReturnModal.tsx': 1,
  'features/sales/CashSessionCloseModal.tsx': 1,
  'features/sales/CashSessionMovementModal.tsx': 1,
  'features/sales/CashSessionOpenModal.tsx': 1,
};

/**
 * Checkout carries the same guarantee inline, against a `canSubmit` that also
 * folds in promotion pricing, loss-prevention policy and manager approvals.
 * Left as it is on purpose: it is the most heavily tested path in the app and
 * rewriting it to reach the shared hook would buy nothing.
 */
const GUARDED_IN_CALLBACK: Record<string, number> = {
  'features/sales/useSalePaymentModal.ts': 1,
};

/**
 * Catalog and configuration forms. A double submit here writes a duplicate
 * row or trips a UNIQUE constraint — irritating, visible, and reversible by
 * the operator. None of them moves money, so they are not in this band.
 * Anything that starts writing money must move up, not stay here.
 */
const UNGUARDED_NON_MONEY: Record<string, number> = {
  'features/categories/CategoryFormModal.tsx': 1,
  'features/company/CompanyLogoFormModal.tsx': 1,
  'features/company/CompanyProfileSettings.tsx': 1,
  'features/customer-catalogs/CustomerCatalogFormModal.tsx': 1,
  'features/customers/CustomerFormModal.tsx': 1,
  'features/geography/CityFormModal.tsx': 1,
  'features/geography/CountryFormModal.tsx': 1,
  'features/geography/DepartmentFormModal.tsx': 1,
  'features/locations/LocationFormModal.tsx': 1,
  'features/providers/ProviderCategoryAssignmentsModal.tsx': 1,
  'features/providers/ProviderFormModal.tsx': 1,
  'features/restaurants/RestaurantTableFormModal.tsx': 1,
  'features/sequentials/SequentialFormModal.tsx': 1,
  'features/sites/SiteFormModal.tsx': 1,
  'features/sites/SiteLocationAssignmentsModal.tsx': 1,
  'features/staff/AttendanceCorrectionModal.tsx': 2,
  'features/staff/ScheduleShiftModal.tsx': 2,
  'features/units/UnitFormModal.tsx': 1,
  'features/users/UsersPage.tsx': 2,
  'features/vat-rates/VatRateFormModal.tsx': 1,
};

const HANDLE_SUBMIT = /\bform\.handleSubmit\(/g;
const GUARDED_HANDLE_SUBMIT = /\bform\.handleSubmit\(\s*useSingleFlightSubmit\(/g;

/** Every source file under `features/` that pairs `isSaving` with a form submit. */
function scanSubmitSites(): Map<string, number> {
  const files = fg.sync('**/*.{ts,tsx}', {
    cwd: FEATURES_DIR,
    ignore: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
  });
  const sites = new Map<string, number>();
  for (const relative of files) {
    const source = readFileSync(path.join(FEATURES_DIR, relative), 'utf8');
    if (!source.includes('isSaving')) continue;
    const count = source.match(HANDLE_SUBMIT)?.length ?? 0;
    if (count > 0) sites.set(path.posix.join('features', relative), count);
  }
  return sites;
}

function read(relative: string): string {
  return readFileSync(path.join(SRC_DIR, relative), 'utf8');
}

describe('money modal submit guard', () => {
  const sites = scanSubmitSites();

  it('finds the submit sites at all', () => {
    // Guards the guard. A regex that matched nothing would make every
    // assertion below vacuously true, which is the failure mode a source
    // scan is most prone to.
    expect(sites.size).toBeGreaterThan(20);
    expect(sites.get('features/customers/CustomerLedgerAbonoModal.tsx')).toBe(1);
  });

  it('classifies every submit site exactly once', () => {
    const declared = { ...GUARDED_BY_HOOK, ...GUARDED_IN_CALLBACK, ...UNGUARDED_NON_MONEY };
    const buckets = [GUARDED_BY_HOOK, GUARDED_IN_CALLBACK, UNGUARDED_NON_MONEY];
    const seen = new Set<string>();
    for (const bucket of buckets) {
      for (const file of Object.keys(bucket)) {
        expect(seen.has(file), `${file} appears in two buckets`).toBe(false);
        seen.add(file);
      }
    }

    const scanned = Object.fromEntries([...sites].sort());
    // Both directions: an unclassified new modal fails, and so does a stale
    // entry left behind after a file is deleted or renamed.
    expect(scanned).toEqual(Object.fromEntries(Object.entries(declared).sort()));
  });

  it('routes every money modal submit through useSingleFlightSubmit', () => {
    for (const [file, expected] of Object.entries(GUARDED_BY_HOOK)) {
      const source = read(file);
      expect(source.match(GUARDED_HANDLE_SUBMIT)?.length ?? 0, file).toBe(expected);
      expect(source.includes("from '@/lib/useSingleFlightSubmit'"), file).toBe(true);
    }
  });

  it('derives each money modal guard from its own confirm-button state', () => {
    // `canSubmit` must be the SAME expression the footer button disables on,
    // not merely `!isSaving`: the submit event bypasses every precondition the
    // button encodes, so a guard that only knew about the pending flag would
    // still let Enter adjust a lot-tracked product or close a till whose
    // denominations do not add up.
    for (const file of Object.keys(GUARDED_BY_HOOK)) {
      const source = read(file);
      expect(source, file).toMatch(/const canSubmit = [^;]*!isSaving/);
      expect(source, file).toMatch(/useSingleFlightSubmit\(canSubmit,/);
    }
  });

  it('keeps the checkout path guarded inline', () => {
    const source = read('features/sales/useSalePaymentModal.ts');
    expect(source).toMatch(/const canSubmit =/);
    expect(source).toMatch(/if \(!canSubmit\) \{\s*\n\s*return;/);
  });
});
