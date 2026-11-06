import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Alert } from './Alert.vue'
export { default as AlertDescription } from './AlertDescription.vue'
export { default as AlertTitle } from './AlertTitle.vue'

export const alertVariants = cva(
  'relative w-full rounded-lg border px-4 py-3 text-sm grid has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'text-foreground bg-destructive/8 border-destructive/30 [&>svg]:text-destructive *:data-[slot=alert-description]:text-foreground/80 dark:bg-destructive/10 dark:border-destructive/25',
        warning:
          'text-foreground bg-warning/8 border-warning/30 [&>svg]:text-warning *:data-[slot=alert-description]:text-foreground/80 dark:bg-warning/10 dark:border-warning/25',
        success:
          'text-foreground bg-success/8 border-success/30 [&>svg]:text-success *:data-[slot=alert-description]:text-foreground/80 dark:bg-success/10 dark:border-success/25',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type AlertVariants = VariantProps<typeof alertVariants>
