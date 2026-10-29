<script setup lang="ts" generic="Value extends string">
import { useId } from 'vue';
import { LayoutGroup, motion } from 'motion-v';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const props = withDefaults(
  defineProps<{
    modelValue: Value | undefined;
    options: readonly { readonly value: Value; readonly label: string; readonly disabled?: boolean }[];
    label: string;
    id?: string;
    disabled?: boolean;
    testId?: string;
    size?: 'sm' | 'md';
  }>(),
  { id: undefined, disabled: false, testId: undefined, size: 'sm' },
);
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>();
const thumb = `${useId()}-thumb`;

function choose(value: unknown) {
  // A single toggle group emits '' when the active item is pressed again; keep it.
  const option = props.options.find((item) => item.value === value);
  if (option) emit('update:modelValue', option.value);
}
</script>
<template>
  <LayoutGroup>
    <ToggleGroup
      :id="id"
      type="single"
      :spacing="1"
      class="segmented-control"
      :data-size="size"
      :model-value="modelValue"
      :disabled="disabled"
      :aria-label="label"
      :data-testid="testId"
      @update:model-value="choose"
    >
      <ToggleGroupItem
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
        :data-value="option.value"
        class="segmented-control-item data-[state=on]:bg-transparent hover:bg-transparent"
      >
        <motion.span
          v-if="option.value === modelValue"
          :layout-id="thumb"
          class="segmented-control-thumb"
          :transition="{ type: 'spring', stiffness: 560, damping: 38 }"
          aria-hidden="true"
        />
        <span class="relative">{{ option.label }}</span>
      </ToggleGroupItem>
    </ToggleGroup>
  </LayoutGroup>
</template>
<style>
.segmented-control {
  gap: 2px;
  padding: 2px;
  border-radius: 0.65rem;
  background: color-mix(in srgb, var(--foreground) 6.5%, transparent);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.segmented-control-item {
  position: relative;
  height: 1.85rem;
  min-width: 0;
  border-radius: 0.5rem;
  padding-inline: 0.8rem;
  color: var(--muted-foreground);
  font-size: 0.8rem;
  font-weight: 500;
  transition: color 160ms ease;
}
.segmented-control[data-size='md'] .segmented-control-item {
  height: 2.2rem;
  padding-inline: 1rem;
  font-size: 0.85rem;
}
.segmented-control-item:hover {
  color: var(--foreground);
}
.segmented-control-item[data-state='on'] {
  color: var(--foreground);
}
.segmented-control-thumb {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--surface);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.12),
    0 0 0 0.5px rgb(0 0 0 / 0.06);
}
</style>
