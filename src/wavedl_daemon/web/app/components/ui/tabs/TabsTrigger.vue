<script setup lang="ts">
import type { TabsTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { motion, useReducedMotion } from 'motion-v'
import { TabsTrigger, injectTabsRootContext, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const SEGMENT_SPRING = {
  bounce: 0.05,
  duration: 0.25,
  type: 'spring',
}

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegatedProps)

const tabsContext = injectTabsRootContext()
const isActive = computed(() => tabsContext.modelValue.value === props.value)
const shouldReduceMotion = useReducedMotion()
const indicatorTransition = computed(() =>
  shouldReduceMotion.value ? { duration: 0 } : SEGMENT_SPRING,
)
</script>

<template>
  <!-- Auto-height lists cannot resolve percentage heights; retain the original single-row height. -->
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="forwardedProps"
    :class="cn(
      `data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-muted-foreground relative inline-flex h-[calc(var(--spacing)*9-7px)] min-w-0 flex-auto items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors duration-500 ease-in-out focus-visible:ring-3 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
      props.class,
    )"
  >
    <motion.span
      v-if="isActive"
      data-slot="tabs-indicator"
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 rounded-md border border-transparent bg-background shadow-sm dark:border-input dark:bg-input/30"
      layout
      layout-id="tabs-indicator"
      :style="{ originY: '0px' }"
      :transition="indicatorTransition"
    />
    <span class="relative z-10 inline-flex items-center justify-center gap-1.5">
      <slot />
    </span>
  </TabsTrigger>
</template>
