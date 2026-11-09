<script setup lang="ts">
import type { Component } from 'vue';

const props = defineProps<{
  id: string;
  label: string;
  icon: Component;
  collapsed: boolean;
  active?: boolean;
  primary?: boolean;
  badge?: string;
  badgeLabel?: string;
  accessibleName?: string;
  hint?: string;
  ariaKeyshortcuts?: string;
  tooltip?: string;
  expanded?: boolean;
  controls?: string;
}>();

const emit = defineEmits<{ select: [] }>();

const accessibleLabel = computed(() =>
  props.accessibleName ?? (props.badgeLabel ? `${props.label} · ${props.badgeLabel}` : props.label),
);
</script>

<template>
  <Tooltip :disabled="!props.collapsed">
    <TooltipTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        class="shell-sidebar-row"
        :class="{
          'shell-sidebar-row-active': props.active,
          'shell-sidebar-row-primary': props.primary,
        }"
        :aria-label="accessibleLabel"
        :aria-current="props.active ? 'page' : undefined"
        :aria-expanded="props.expanded"
        :aria-controls="props.controls"
        :aria-keyshortcuts="props.ariaKeyshortcuts"
        :data-testid="`nav-${props.id}`"
        @click="emit('select')"
      >
        <span class="shell-sidebar-icon" aria-hidden="true">
          <component :is="props.icon" class="size-4" />
        </span>
        <span class="shell-sidebar-label">{{ props.label }}</span>
        <span class="shell-sidebar-trailing">
          <span v-if="props.badge" class="shell-sidebar-badge" aria-hidden="true">{{ props.badge }}</span>
          <kbd v-if="props.hint" class="shell-sidebar-hint" aria-hidden="true">{{ props.hint }}</kbd>
          <slot />
        </span>
      </Button>
    </TooltipTrigger>
    <TooltipContent v-if="props.collapsed" side="right" :side-offset="10">
      {{ props.tooltip ?? accessibleLabel }}
    </TooltipContent>
  </Tooltip>
</template>
