<script setup lang="ts">
import { cn } from '@/lib/utils';

defineProps<{ title: string }>();

const heading = useTemplateRef<HTMLHeadingElement>('heading');

function focusHeading() {
  heading.value?.focus({ preventScroll: true });
}

defineExpose({ focusHeading });

const projectStyles = {
  stepTitle: cn(
    'text-lg font-semibold tracking-[-0.02em] outline-none sm:text-[1.45rem]',
    'focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring',
  ),
};
</script>
<template>
  <header>
    <h2 ref="heading" :class="projectStyles.stepTitle" tabindex="-1">{{ title }}</h2>
  </header>
</template>
