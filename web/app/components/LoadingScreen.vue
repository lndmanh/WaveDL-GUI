<template>
  <AuroraBackground :radial-gradient="false">
    <div :class="cn('fixed inset-0 z-50 flex flex-col items-center justify-center p-4')">
      <MaxWidthWrapper class="flex flex-col items-center justify-center">
        <div class="flex flex-col items-center gap-6 text-center">
          <Spinner variant="ring" size="lg" :label="message" class="mb-4 text-primary" />
          <span class="text-center px-4 mt-2 font-semibold text-lg">
            {{ message }}
          </span>
        </div>
      </MaxWidthWrapper>
    </div>
  </AuroraBackground>
</template>

<script setup lang="ts">
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

withDefaults(defineProps<{ message?: string }>(), {
  message: 'Loading...',
});

defineOptions({
  inheritAttrs: false,
});
</script>
