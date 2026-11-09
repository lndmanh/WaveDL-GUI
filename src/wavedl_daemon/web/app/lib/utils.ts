import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// The static workstation only needs shadcn class composition, not the upstream
// marketing/date/table helpers and their unrelated dependency graph.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function primaryShortcut(key: string) {
  const apple = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

  return {
    hint: apple ? `⌘${key}` : `Ctrl+${key}`,
    ariaKeyshortcuts: `${apple ? 'Meta' : 'Control'}+${key}`,
  };
}
