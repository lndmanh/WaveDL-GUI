<template>
  <Popover>
    <PopoverTrigger as-child>
      <Button variant="ghost" size="icon">
        <PaintbrushIcon :size="16" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-92" :align="breakpoints.isGreaterOrEqual('md') ? 'end' : 'center'">
      <ThemeCustomizer />
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import { PaintbrushIcon } from '@lucide/vue';
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core';

const breakpoints = useBreakpoints(breakpointsTailwind);
</script>
