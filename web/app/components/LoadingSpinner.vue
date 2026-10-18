<template>
  <div class="flex items-center justify-center" :class="containerClass">
    <div class="flex flex-col items-center gap-3">
      <Spinner
        variant="svg"
        :size="size"
        :label="text ?? 'Loading'"
        class="text-muted-foreground"
      />
      <p v-if="text" class="text-sm text-muted-foreground animate-pulse">
        {{ text }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Spinner } from '@/components/ui/spinner';

const props = withDefaults(
  defineProps<{
    size?: 'sm' | 'md' | 'lg';
    text?: string;
    fullHeight?: boolean;
  }>(),
  {
    size: 'md',
    fullHeight: false,
  },
);

const containerClass = computed(() => {
  const classes = [];

  if (props.fullHeight) {
    classes.push('h-64');
  } else {
    classes.push('py-8');
  }

  return classes.join(' ');
});
</script>
