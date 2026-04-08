import { useRef } from 'react';

export function useSalesInputFocus() {
  const productInputRef = useRef<HTMLInputElement | null>(null);
  const quantityInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const discountInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const focusProductInput = () => {
    productInputRef.current?.focus();
    productInputRef.current?.select();
  };

  const focusQuantityInput = (itemKey: string) => {
    quantityInputRefs.current[itemKey]?.focus();
    quantityInputRefs.current[itemKey]?.select();
  };

  const focusDiscountInput = (itemKey: string) => {
    discountInputRefs.current[itemKey]?.focus();
    discountInputRefs.current[itemKey]?.select();
  };

  const quantityInputRefFor = (itemKey: string) => (node: HTMLInputElement | null) => {
    quantityInputRefs.current[itemKey] = node;
  };

  const discountInputRefFor = (itemKey: string) => (node: HTMLInputElement | null) => {
    discountInputRefs.current[itemKey] = node;
  };

  return {
    productInputRef,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
    quantityInputRefFor,
    discountInputRefFor,
  };
}
