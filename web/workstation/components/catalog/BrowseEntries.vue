<script setup lang="ts">
import { Button } from '@/components/ui/button';
import { Folder, File } from '@lucide/vue';
import type { BrowsePage } from '../../lib/catalog-api';
import { catalogMessages } from '../../i18n/catalog';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
const { t } = useWorkstationI18n(catalogMessages);
defineProps<{ page: BrowsePage; busy: boolean; allowDirectory: boolean }>();
const emit = defineEmits<{
  open: [name: string];
  select: [name: string];
  page: [offset: number];
}>();
</script>
<template>
  <div class="flex flex-col gap-3">
    <p v-if="!page.entries.length" role="status">{{ t('emptyDirectory') }}</p>
    <ul class="flex flex-col gap-2" :aria-label="t('entries')">
      <li
        v-for="entry in page.entries"
        :key="entry.name"
        class="flex items-center justify-between gap-3"
      >
        <Button
          v-if="entry.kind === 'directory'"
          variant="ghost"
          :disabled="busy"
          @click="emit('open', entry.name)"
        >
          <Folder data-icon="inline-start" />{{ entry.name }}
        </Button>
        <span v-else class="flex items-center gap-2"><File class="size-4" />{{ entry.name }}</span>
        <Button
          v-if="entry.kind === 'file' || allowDirectory"
          variant="outline"
          size="sm"
          :disabled="busy"
          :aria-label="t('selectEntry', { kind: t(entry.kind), name: entry.name })"
          @click="emit('select', entry.name)"
          >{{ t('selectKind', { kind: t(entry.kind) }) }}</Button
        >
      </li>
    </ul>
    <div class="flex items-center gap-3">
      <Button
        variant="outline"
        :disabled="busy || page.offset === 0"
        @click="emit('page', Math.max(0, page.offset - page.limit))"
        >{{ t('previousEntries') }}</Button
      >
      <p>
        {{
          t('entryCount', {
            start: page.total ? page.offset + 1 : 0,
            end: page.offset + page.entries.length,
            total: page.total,
          })
        }}
      </p>
      <Button
        variant="outline"
        :disabled="busy || page.offset + page.limit >= page.total"
        @click="emit('page', page.offset + page.limit)"
        >{{ t('nextEntries') }}</Button
      >
    </div>
  </div>
</template>
