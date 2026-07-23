import { cva, type VariantProps } from 'class-variance-authority';

export const buttonVariants = cva('', {
  variants: {
    variant: {
      primary: 'btn-primary',
      secondary: 'btn-secondary',
      outline: 'btn-outline',
      ghost: 'btn-ghost',
      success: 'btn-success',
      danger: 'btn-danger',
    },
    size: {
      default: '',
      compact: 'min-h-9 px-3 py-1.5',
      icon: 'btn-icon h-11 min-h-11 w-11',
      iconCompact: 'btn-icon h-8 min-h-8 w-8',
    },
  },
  defaultVariants: {
    variant: 'primary',
    size: 'default',
  },
});

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;
