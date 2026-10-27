<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import type { ShellNavigationDescriptor } from '../../shell/sections';

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
    class="shell-dock-action"
    :data-active="props.active ? '' : undefined"
    :data-testid="`nav-${props.item.id}`"
    :aria-current="props.active ? 'page' : undefined"
    :aria-label="t(props.item.labelKey)"
    @click="emit('select', props.item)"
  >
    <component :is="props.item.icon" class="size-4" aria-hidden="true" />
    <span class="sr-only">{{ t(props.item.labelKey) }}</span>
  </Button>
</template>
