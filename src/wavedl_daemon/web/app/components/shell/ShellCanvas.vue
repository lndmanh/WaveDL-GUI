<script setup lang="ts">
import { shallowRef } from 'vue';
import { provideShellScroll } from '../../composables/useShellScroll';

const scrollContainer = shallowRef<HTMLElement | null>(null);
provideShellScroll(scrollContainer);
</script>

<template>
  <main tabindex="-1" class="shell-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <slot name="header" />
    <div
      id="workspace"
      ref="scrollContainer"
      class="shell-scroll relative min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
      data-shell-scroll
      tabindex="-1"
      data-testid="workstation-content"
    >
      <div class="shell-canvas-content">
        <slot />
      </div>
    </div>
  </main>
</template>
