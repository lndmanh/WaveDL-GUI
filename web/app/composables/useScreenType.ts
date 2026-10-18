import { computed } from 'vue';
import { useWindowSize } from '@vueuse/core';
import type { ScreenType } from '~~/types/screen';

// Breakpoints matching Tailwind defaults
export const BREAKPOINTS: Record<'sm' | 'md' | 'lg' | 'xl' | '2xl', number> = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

export type { ScreenType } from '~~/types/screen';

export function useScreenType() {
  const { width } = useWindowSize();

  const screenType = computed<ScreenType>(() => {
    const w = width.value;
    if (w >= BREAKPOINTS['2xl']) return '2xl';
    if (w >= BREAKPOINTS.xl) return 'xl';
    if (w >= BREAKPOINTS.lg) return 'lg';
    if (w >= BREAKPOINTS.md) return 'md';
    if (w >= BREAKPOINTS.sm) return 'sm';
    return 'xs';
  });

  return {
    screenType,
    width,
  };
}
