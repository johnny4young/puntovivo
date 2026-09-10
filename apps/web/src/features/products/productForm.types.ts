import type { ProductTemplateVerticalId } from '@puntovivo/shared/vertical-presets';
import type { UnitDimension } from '@puntovivo/shared/units';
import type { Product } from '@/types';

export type ProductRole = 'create' | 'edit';
export type ProductFormExperience = 'quick' | 'advanced';
export type ProductFormOrigin = 'catalog' | 'sale';

export interface LookupOption {
  id: string;
  name: string;
}

export interface UnitLookupOption extends LookupOption {
  abbreviation: string;
  isActive?: boolean;
  dimension?: UnitDimension | null;
  referenceFactor?: number | null;
}

export interface VatRateOption extends LookupOption {
  rate: number;
  kind: 'iva' | 'inc';
}

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  providerId: string;
  vatRateId: string;
  taxComponentVatRateIds: string[];
  locationId: string;
  barcode: string;
  imageUrl: string;
  cost: number;
  initialCost: number;
  price: number;
  price2: number;
  price3: number;
  marginPercent1: number;
  marginPercent2: number;
  marginPercent3: number;
  marginAmount1: number;
  marginAmount2: number;
  marginAmount3: number;
  taxRate: number;
  stock: number;
  minStock: number;
  sellByFraction: boolean;
  fractionStep: number;
  fractionMinimum: number;
  tracksStock: boolean;
  tracksLots: boolean;
  tracksSerials: boolean;
  isActive: boolean;
  unitAssignments: ProductUnitAssignmentFormValues[];
  providerAssignments: ProductProviderAssignmentFormValues[];
  pharmacyEnabled: boolean;
  pharmacy: PharmacyProductFormValues;
}

export interface PharmacyProductFormValues {
  activeIngredient: string;
  genericName: string;
  concentration: string;
  dosageForm: string;
  administrationRoute: string;
  presentation: string;
  manufacturer: string;
  authorizationHolder: string;
  sanitaryRegistration: string;
  registrationExpiresAt: string;
  classification: 'otc' | 'prescription' | 'controlled';
  storageConditions: string;
  requiresColdChain: boolean;
}

export interface ProductUnitAssignmentFormValues {
  unitId: string;
  equivalence: number;
  price: number;
  price2: number;
  price3: number;
  isBase: boolean;
}

export interface ProductProviderAssignmentFormValues {
  providerId: string;
}

export interface ProductFormModalProps {
  mode: ProductRole;
  isOpen: boolean;
  product: Product | null;
  categories: LookupOption[];
  locations: LookupOption[];
  providers: LookupOption[];
  units: UnitLookupOption[];
  vatRates: VatRateOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  /**
   * Persists the form. May return the newly created product so the
   * quick-create flow () can hand it back to the caller via
   * `onCreated`. Existing callers that ignore the return value stay
   * backward compatible — TypeScript treats `Promise<Product | void>`
   * as compatible with a `Promise<void>` consumer.
   */
  onSubmit: (values: ProductFormValues) => Promise<Product | void>;
  /**
   * pre-fill the `name` field on `mode='create'`. Useful
   * when the dialog is opened from the ProductSearchDialog empty
   * state with the typed query. Ignored on `mode='edit'` (the
   * existing product's name wins). Defaults to no pre-fill.
   */
  // explicit `| undefined` on optional fields.
  defaultName?: string | undefined;
  /**
   * fired once `onSubmit` succeeds AND `mode='create'`
   * AND the resolved value is a real product. Lets the caller add
   * the new product to the cart, attach to a sale, etc. Skipped on
   * error or on edit-mode submits.
   */
  onCreated?: ((product: Product) => void) | undefined;
  /**
   * Create mode can start with the minimum sellable fields and progressively
   * disclose the existing advanced form. Edit mode always uses the advanced
   * experience because every persisted setting must remain reachable.
   */
  initialExperience?: ProductFormExperience | undefined;
  /** Explains what happens after a quick create succeeds. */
  origin?: ProductFormOrigin | undefined;
  /**
   * Lets a lazy caller load advanced lookup catalogs only after the operator
   * explicitly asks for them.
   */
  onExperienceChange?: ((experience: ProductFormExperience) => void) | undefined;
  /** Keeps the shared form mounted while its advanced lookup catalogs load. */
  advancedLookupsPending?: boolean | undefined;
  /**
   * Aggregate, content-free task signals for create mode. Neither callback
   * receives field values or error text.
   */
  onInvalid?: (() => void) | undefined;
  /** Show explicit templates only for the tenant's selected vertical. */
  templateVertical?: ProductTemplateVerticalId | null | undefined;
  /** Enables the regulated catalog experience for pharmacy tenants. */
  pharmacyMode?: boolean | undefined;
}

export type PricingField = 'price' | 'price2' | 'price3';
export type MarginPercentField = 'marginPercent1' | 'marginPercent2' | 'marginPercent3';
export type MarginAmountField = 'marginAmount1' | 'marginAmount2' | 'marginAmount3';
export type ProductFormTab = 'general' | 'pharmacy' | 'pricing' | 'units' | 'providers';
