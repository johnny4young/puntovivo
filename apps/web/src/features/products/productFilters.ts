export interface ProductFilters {
  categoryId: string;
  status: 'all' | 'active' | 'inactive';
  lowStock: boolean;
  lowMargin: boolean;
}

export const NO_PRODUCT_FILTERS: ProductFilters = {
  categoryId: '',
  status: 'all',
  lowStock: false,
  lowMargin: false,
};

export const LOW_MARGIN_PERCENT = 20;
