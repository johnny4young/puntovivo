// Re-export UI primitives for backward compatibility
export { Input, type InputProps } from '@/components/ui';

// Form Components
export { Select, type SelectProps, type SelectOption } from './Select';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { DatePicker, type DatePickerProps } from './DatePicker';
export {
  FormField,
  SimpleFormField,
  type FormFieldProps,
  type SimpleFormFieldProps,
} from './FormField';
export {
  Modal,
  ModalButton,
  ConfirmModal,
  type ModalProps,
  type ModalButtonProps,
  type ConfirmModalProps,
} from './Modal';
