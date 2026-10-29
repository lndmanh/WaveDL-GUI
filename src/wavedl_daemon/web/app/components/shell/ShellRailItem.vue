<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import { motion, useMotionValue, useSpring, useTransform } from 'motion-v';
import type { MotionValue, SpringOptions } from 'motion-v';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ShellNavigationDescriptor } from '../../shell/sections';

const props = withDefaults(
  defineProps<{
    item: ShellNavigationDescriptor;
    label: string;
    active?: boolean;
    pointerY?: MotionValue<number>;
    magnify?: boolean;
  }>(),
  {
    active: false,
    pointerY: undefined,
    magnify: true,
  },
);

const emit = defineEmits<{ select: [item: ShellNavigationDescriptor] }>();

const BASE_SIZE = 36;
const MAGNIFIED_SIZE = 64;
const FALLOFF = 120;
const SPRING: SpringOptions = { mass: 0.1, stiffness: 150, damping: 12 };
const ICON_RATIO = 4 / 9;
const root = useTemplateRef<HTMLElement>('root');
const fallbackPointerY = useMotionValue(Number.POSITIVE_INFINITY);
const pointerY = computed(() => props.pointerY ?? fallbackPointerY);
const cursorOffset = useTransform(pointerY.value, (value) => {
  const rect = root.value?.getBoundingClientRect();
  return rect ? value - rect.y - rect.height / 2 : Number.POSITIVE_INFINITY;
});
const sizeTarget = useTransform(
  cursorOffset,
  [-FALLOFF, 0, FALLOFF],
  [BASE_SIZE, MAGNIFIED_SIZE, BASE_SIZE],
);
const size = useSpring(sizeTarget, SPRING);
const sizePx = useTransform(size, (value) => `${props.magnify ? value : BASE_SIZE}px`);
const iconSizePx = useTransform(size, (value) => `${value * ICON_RATIO}px`);

const buttonClass = computed(() => [
  'shell-rail-control rounded-full',
  props.active ? 'shell-rail-control-active' : undefined,
]);

function select(): void {
  emit('select', props.item);
}
</script>

<template>
  <div ref="root" class="shell-rail-item">
    <motion.div class="flex items-center justify-center" :style="{ width: sizePx, height: sizePx }">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              :style="{ width: '100%', height: '100%' }"
              :class="buttonClass"
              :data-active="props.active ? '' : undefined"
              :data-testid="`nav-${props.item.id}`"
              :aria-label="props.label"
              :aria-current="props.active ? 'page' : undefined"
              :title="props.label"
              @click="select"
            >
              <motion.span
                class="flex items-center justify-center"
                :style="{ width: iconSizePx, height: iconSizePx }"
              >
                <component :is="props.item.icon" class="size-full" aria-hidden="true" />
              </motion.span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="10">{{ props.label }}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </motion.div>
  </div>
</template>
