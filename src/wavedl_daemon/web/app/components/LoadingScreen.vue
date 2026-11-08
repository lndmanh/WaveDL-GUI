<template>
  <main
    class="fixed inset-0 grid place-items-center bg-background p-6 text-foreground"
    aria-busy="true"
  >
    <div class="flex flex-col items-center gap-3 text-center">
      <Spinner variant="ellipsis" size="md" class="text-muted-foreground" />
      <ShimmeringText class="text-base font-medium tracking-tight sm:text-lg" :text="message" />
    </div>
  </main>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ message?: string }>(), {
  message: 'Loading...',
});

defineOptions({
  inheritAttrs: false,
});
</script>
