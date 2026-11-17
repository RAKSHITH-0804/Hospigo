import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-transparent bg-clip-padding text-[length:var(--font-size-body)] font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-[var(--size-button-height)] gap-[var(--space-1)] px-[var(--space-2)] has-data-[icon=inline-end]:pr-[var(--space-2)] has-data-[icon=inline-start]:pl-[var(--space-2)]',
        xs: "h-[var(--size-button-height)] gap-[var(--space-1)] rounded-[var(--radius-control)] px-[var(--space-2)] text-[length:var(--font-size-small)] has-data-[icon=inline-end]:pr-[var(--space-1)] has-data-[icon=inline-start]:pl-[var(--space-1)] [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--size-button-height)] gap-[var(--space-1)] rounded-[var(--radius-control)] px-[var(--space-2)] text-[length:var(--font-size-small)] has-data-[icon=inline-end]:pr-[var(--space-1)] has-data-[icon=inline-start]:pl-[var(--space-1)] [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-[var(--size-button-height)] gap-[var(--space-1)] px-[var(--space-3)] has-data-[icon=inline-end]:pr-[var(--space-2)] has-data-[icon=inline-start]:pl-[var(--space-2)]',
        icon: 'size-[var(--size-button-height)]',
        'icon-xs':
          'size-[var(--size-button-height)] rounded-[var(--radius-control)] [&_svg:not([class*="size-"])]:size-3',
        'icon-sm':
          'size-[var(--size-button-height)] rounded-[var(--radius-control)] [&_svg:not([class*="size-"])]:size-3.5',
        'icon-lg': 'size-[var(--size-button-height)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
