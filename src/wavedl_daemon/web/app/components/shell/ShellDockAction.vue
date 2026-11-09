<script setup lang="ts">
import type { ShellNavigationDescriptor } from '~~/types/shell';

const props = defineProps<{
  item: ShellNavigationDescriptor;
  active?: boolean;
  badge?: string;
}>();

const emit = defineEmits<{ select: [item: ShellNavigationDescriptor] }>();
const { t } = useI18n({ useScope: 'global' });

const accessibleName = computed(() => {
  const label = t(props.item.labelKey);

  return props.badge ? `${label}, ${t('shell.liveRunsBadge', { count: props.badge })}` : label;
});
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    class="shell-dock-action shell-dock-action--dock"
    :data-active="props.active ? '' : undefined"
    :data-testid="`nav-${props.item.id}`"
    :aria-current="props.active ? 'page' : undefined"
    :aria-label="accessibleName"
    @click="emit('select', props.item)"
  >
    <span class="relative shrink-0" aria-hidden="true">
      <component :is="props.item.icon" />
      <span v-if="props.badge" class="shell-dock-badge absolute -top-1 -right-2 ring-2 ring-background">{{ props.badge }}</span>
    </span>
    <span class="shell-dock-action-label">{{ t(props.item.labelKey) }}</span>
  </Button>
</template>
