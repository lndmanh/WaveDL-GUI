<script setup lang="ts">
import { useId } from 'vue';

/** `titleHidden` keeps the accessible name for panels whose controls speak for themselves. */
defineProps<{ title: string; description?: string; titleHidden?: boolean }>();
const titleId = useId();
</script>
<template>
  <section class="inspector-panel" :aria-labelledby="titleId">
    <h2 v-if="titleHidden" :id="titleId" class="sr-only">{{ title }}</h2>
    <header v-else class="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div class="min-w-0">
        <h2 :id="titleId" class="text-[1.45rem] font-semibold tracking-[-0.02em]">{{ title }}</h2>
        <p v-if="description" class="mt-1 max-w-[60ch] text-sm text-muted-foreground">
          {{ description }}
        </p>
      </div>
      <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>
<style>
.inspector-panel {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  animation: inspector-enter 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* Panels toggle with v-show; a display change restarts this entrance. */
@keyframes inspector-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
