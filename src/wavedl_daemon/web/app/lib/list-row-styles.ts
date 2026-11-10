import { cn } from '@/lib/utils';

export const listRowStyles = {
  row: cn(
    'h-[38px] cursor-pointer text-sm transition-colors motion-reduce:transition-none',
    'hover:bg-muted/50 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-ring',
    'data-[selected=true]:bg-primary/10 data-[selected=true]:shadow-[inset_3px_0_0_var(--primary)]',
  ),
  cell: cn('h-[38px] min-w-0 overflow-hidden whitespace-nowrap border-b border-border/50 px-2'),
  glyph: cn(
    'relative block size-[0.55rem] shrink-0 rounded-full bg-foreground/20',
    'data-[state=running]:bg-primary data-[state=submitted]:bg-primary data-[state=queued]:bg-primary data-[state=pending]:bg-primary',
    'data-[state=completed]:bg-success data-[state=failed]:bg-destructive',
    'data-[state=held]:bg-warning data-[state=stopping]:bg-warning',
    'data-[state=submission_unknown]:bg-warning data-[state=terminal_unknown]:bg-warning data-[state=supervision_lost]:bg-warning',
    "[&[data-state='running']::after]:content-[''] [&[data-state='running']::after]:absolute",
    "[&[data-state='running']::after]:inset-[-3px] [&[data-state='running']::after]:rounded-[inherit]",
    "[&[data-state='running']::after]:border-2 [&[data-state='running']::after]:border-primary",
    "[&[data-state='running']::after]:[animation:run-glyph-pulse_1.8s_cubic-bezier(0.22,_1,_0.36,_1)_infinite]",
    "motion-reduce:[&[data-state='running']::after]:animate-none",
  ),
  state: cn(
    'flex items-center [&_.run-state-chip]:whitespace-nowrap [&_.run-state-chip]:flex-nowrap',
    '[&_.run-state-chip]:max-h-7 [&_.run-state-chip]:overflow-hidden',
  ),
  title: cn('run-row min-w-0 truncate text-left font-semibold tracking-[-0.01em] outline-none'),
  trailing: cn(
    'inline-flex shrink-0 items-center gap-1.5 text-[0.7rem] text-muted-foreground tabular-nums',
  ),
};
