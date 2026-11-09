<script setup lang="ts">
import type { ShellNavigationDescriptor } from '~~/types/shell';

const props = defineProps<{
  item: ShellNavigationDescriptor;
  active?: boolean;
}>();

const emit = defineEmits<{ select: [item: ShellNavigationDescriptor] }>();
const { t } = useI18n({ useScope: 'global' });
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    class="shell-dock-action shell-dock-action--dock"
    :data-active="props.active ? '' : undefined"
    :data-testid="`nav-${props.item.id}`"
    :aria-current="props.active ? 'page' : undefined"
    :aria-label="t(props.item.labelKey)"
    @click="emit('select', props.item)"
  >
    <component :is="props.item.icon" aria-hidden="true" />
    <span class="shell-dock-action-label">{{ t(props.item.labelKey) }}</span>
  </Button>
</template>
