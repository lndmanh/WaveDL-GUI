<script setup lang="ts">
import type { TabsListProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { useId } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { LayoutGroup } from 'motion-v'
import { TabsList } from 'reka-ui'
import { cn } from '@/lib/utils'

/**
 * The root is `LayoutGroup`, which renders its slot as a fragment. Vue cannot
 * auto-inherit fallthrough attributes into a fragment root, so `aria-label` and
 * friends were dropped silently before reaching the tablist. Forward them by hand.
 */
defineOptions({
  inheritAttrs: false,
})

const props = defineProps<TabsListProps & { class?: HTMLAttributes['class'] }>()

const delegatedProps = reactiveOmit(props, 'class')
const layoutGroupId = useId()
</script>

<template>
  <LayoutGroup :id="layoutGroupId" :inherit="false">
    <TabsList
      data-slot="tabs-list"
      v-bind="{ ...delegatedProps, ...$attrs }"
      :class="cn(
        'bg-muted text-muted-foreground relative inline-flex h-auto min-h-9 w-fit max-w-full flex-wrap items-center justify-center rounded-lg p-[3px]',
        props.class,
      )"
    >
      <slot />
    </TabsList>
  </LayoutGroup>
</template>
