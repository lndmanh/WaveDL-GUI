<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { motion } from 'motion-v';
import { ChevronRight, FileStack } from '@lucide/vue';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '../../lib/catalog-api';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import DatasetInfoPanel from '../datasets/DatasetInfoPanel.vue';
import DatasetPathPicker from '../datasets/DatasetPathPicker.vue';
import InspectorPanel from './InspectorPanel.vue';

const props = defineProps<{
  session: ConnectionSession;
  selection: DataSelection | null;
  inspection: DatasetInspection | null;
}>();
const emit = defineEmits<{
  select: [selection: DataSelection];
  inspected: [inspection: DatasetInspection | null, selection: DataSelection | null];
}>();
const { t } = useI18n({ useScope: 'global' });

const name = computed(() => props.selection?.path.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
const stats = computed(() => {
  const info = props.inspection;
  if (!info) return [];
  return [
    { label: t('builder.samples'), value: info.numSamples.toLocaleString() },
    { label: t('builder.inputShape'), value: info.inputShape.join(' × ') || '—' },
    { label: t('builder.targetShape'), value: info.outputShape.join(' × ') || '—' },
    { label: t('builder.format'), value: info.format.toUpperCase() },
  ];
});
</script>
<template>
  <InspectorPanel :title="t('builder.datasetTitle')" :description="t('builder.datasetDescription')">
    <div class="dataset-layout">
      <DatasetPathPicker
        :session="session"
        :label="t('project.trainingDataset')"
        :selected="selection"
        @select="emit('select', $event)"
      />

      <aside class="flex min-w-0 flex-col gap-3" :aria-label="t('project.dataset')">
        <motion.div
            v-if="selection"
            :key="selection.path"
            class="surface-group dataset-card"
            :initial="{ opacity: 0, y: 10, scale: 0.98 }"
            :animate="{ opacity: 1, y: 0, scale: 1 }"
            :transition="{ type: 'spring', stiffness: 380, damping: 32 }"
          >
            <div class="flex items-start gap-3">
              <span class="dataset-file"><FileStack aria-hidden="true" /></span>
              <div class="min-w-0">
                <p class="truncate text-[1.05rem] font-semibold" data-testid="selected-dataset">
                  {{ name }}
                </p>
                <p class="mt-0.5 font-mono text-[0.7rem] break-all text-muted-foreground">
                  {{ selection.root }} / {{ selection.relativePath }}
                </p>
              </div>
            </div>
            <dl v-if="stats.length" class="mt-4 grid grid-cols-2 gap-2">
              <div v-for="item in stats" :key="item.label" class="dataset-stat">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </div>
            </dl>
          </motion.div>
          <div v-else class="dataset-empty" data-testid="selected-dataset">
            <span class="dataset-empty-glyph"><FileStack aria-hidden="true" /></span>
            <p class="text-[0.95rem] font-medium">{{ t('builder.noDataset') }}</p>
            <p class="max-w-[28ch] text-xs text-muted-foreground">{{ t('builder.noDatasetHelp') }}</p>
          </div>

        <Collapsible class="surface-group overflow-hidden" :unmount-on-hide="false">
          <CollapsibleTrigger class="dataset-details-trigger">
            <ChevronRight class="dataset-details-chevron" aria-hidden="true" />
            {{ t('builder.headerDetails') }}
          </CollapsibleTrigger>
          <CollapsibleContent class="collapsible-motion">
            <div class="border-t border-[color-mix(in_srgb,var(--foreground)_10%,transparent)] p-4">
              <DatasetInfoPanel
                :session="session"
                :selection="selection"
                @inspected="(inspection, current) => emit('inspected', inspection, current)"
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </aside>
    </div>
  </InspectorPanel>
</template>
<style>
.dataset-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(16rem, 1fr);
  align-items: start;
  gap: 1rem;
}
@media (max-width: 56rem) {
  .dataset-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dataset-file,
.dataset-empty-glyph {
  display: grid;
  flex: none;
  place-items: center;
  border-radius: 0.65rem;
}
.dataset-card {
  padding: 1.1rem;
}
.dataset-file {
  width: 2.6rem;
  height: 2.6rem;
  color: #fff;
  background: linear-gradient(160deg, #35c46a, #1f9d55);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.25);
}
.dataset-file svg {
  width: 1.25rem;
  height: 1.25rem;
}
.dataset-stat {
  padding: 0.6rem 0.75rem;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--foreground) 4.5%, transparent);
}
.dataset-stat dt {
  color: var(--muted-foreground);
  font-size: 0.7rem;
}
.dataset-stat dd {
  margin: 0.15rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.dataset-empty {
  display: flex;
  min-height: 13rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1.5rem;
  border-radius: 1rem;
  border: 1.5px dashed color-mix(in srgb, var(--foreground) 16%, transparent);
  text-align: center;
}
.dataset-empty-glyph {
  width: 2.75rem;
  height: 2.75rem;
  margin-bottom: 0.4rem;
  color: var(--muted-foreground);
  background: color-mix(in srgb, var(--foreground) 5%, transparent);
}
.dataset-empty-glyph svg {
  width: 1.3rem;
  height: 1.3rem;
}
.dataset-details-trigger {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  font-weight: 500;
}
.dataset-details-trigger:hover {
  background: color-mix(in srgb, var(--foreground) 3%, transparent);
}
.dataset-details-chevron {
  width: 1rem;
  height: 1rem;
  color: var(--muted-foreground);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
}
.dataset-details-trigger[data-state='open'] .dataset-details-chevron {
  transform: rotate(90deg);
}
</style>
