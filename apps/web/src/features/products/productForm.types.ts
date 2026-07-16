import type { Product } from '@/types';

export type ProductRole = 'create' | 'edit';

export interface LookupOption {
  id: string;
  name: string;
}

export interface VatRateOption extends LookupOption {
  rate: number;
}

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  providerId: string;
  vatRateId: string;
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
  tracksLots: boolean;
  isActive: boolean;
  unitAssignments: ProductUnitAssignmentFormValues[];
  providerAssignments: ProductProviderAssignmentFormValues[];
}

export interface ProductUnitAssignmentFormValues {
  unitId: string;
  equivalence: number;
  price: number;
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
  units: LookupOption[];
  vatRates: VatRateOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  /**
   * Persists the form. May return the newly created product so the
   * quick-create flow (ENG-105c) can hand it back to the caller via
   * `onCreated`. Existing callers that ignore the return value stay
   * backward compatible — TypeScript treats `Promise<Product | void>`
   * as compatible with a `Promise<void>` consumer.
   */
  onSubmit: (values: ProductFormValues) => Promise<Product | void>;
  /**
   * ENG-105c — pre-fill the `name` field on `mode='create'`. Useful
   * when the dialog is opened from the ProductSearchDialog empty
   * state with the typed query. Ignored on `mode='edit'` (the
   * existing product's name wins). Defaults to no pre-fill.
   */
  // ENG-179b — explicit `| undefined` on optional fields.
  defaultName?: string | undefined;
  /**
   * ENG-105c — fired once `onSubmit` succeeds AND `mode='create'`
   * AND the resolved value is a real product. Lets the caller add
   * the new product to the cart, attach to a sale, etc. Skipped on
   * error or on edit-mode submits.
   */
  onCreated?: ((product: Product) => void) | undefined;
}

export type PricingField = 'price' | 'price2' | 'price3';
export type MarginPercentField = 'marginPercent1' | 'marginPercent2' | 'marginPercent3';
export type MarginAmountField = 'marginAmount1' | 'marginAmount2' | 'marginAmount3';
export type ProductFormTab = 'general' | 'pricing' | 'units' | 'providers';
