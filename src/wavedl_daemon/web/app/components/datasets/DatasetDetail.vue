<script setup lang="ts">
import { ArrowLeft, X } from '@lucide/vue';
import { cn } from '@/lib/utils';
import type { ConnectionSession } from '../../lib/connection-session';
import { pathName } from '../../lib/run-overview';
import type { DataSelection } from '~~/types/catalog-api';

const props = withDefaults(
  defineProps<{
    session: ConnectionSession;
    selection: DataSelection;
    back?: boolean;
  }>(),
  { back: false },
);

defineEmits<{ close: [] }>();

const styles = {
  card: cn(
    'h-full min-h-0 min-w-0 gap-0 overflow-hidden rounded-[1.25rem] border-border/60 bg-surface py-0',
    'shadow-[0_1px_2px_rgb(0_0_0_/_0.04)]',
  ),
  header: cn('flex shrink-0 items-start gap-2 border-b border-border/60 px-4 py-3'),
  title: cn(
    'min-w-0 truncate text-lg font-semibold tracking-tight outline-none',
    'focus-visible:ring-2 focus-visible:ring-ring',
  ),
  body: cn('min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-4'),
};

const { t } = useI18n({ useScope: 'global' });
const title = useTemplateRef<HTMLElement>('title');
const titleId = useId();
const { info, busy, failed } = useDatasetInspection(
  () => props.session,
  () => props.selection,
);

function focusTitle() {
  title.value?.focus({ preventScroll: true });
}

defineExpose({ focusTitle });
</script>

<template>
  <Card :class="styles.card" role="region" :aria-labelledby="titleId">
    <header :class="styles.header">
      <div class="min-w-0 flex-1">
        <h2
          :id="titleId"
          ref="title"
          tabindex="-1"
          :class="styles.title"
          :title="pathName(selection.path)"
        >
          {{ pathName(selection.path) }}
        </h2>
        <p class="mt-1 truncate font-mono text-xs text-muted-foreground" :title="selection.path">
          {{ selection.path }}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="shrink-0"
        :aria-label="back ? t('datasets.backToBrowser') : t('datasets.closeDetail')"
        :title="back ? t('datasets.backToBrowser') : t('datasets.closeDetail')"
        @click="$emit('close')"
      >
        <ArrowLeft v-if="back" aria-hidden="true" />
        <X v-else aria-hidden="true" />
      </Button>
    </header>
    <div :class="styles.body">
      <section :aria-label="t('datasets.technicalDetails')" :aria-busy="busy">
        <div v-if="busy" class="space-y-3" role="status" :aria-label="t('datasets.headerLoading')">
          <Skeleton class="h-4 w-32" />
          <Skeleton class="h-4 w-2/3" />
          <Skeleton class="h-4 w-1/2" />
        </div>
        <DatasetInfoPanel v-else-if="info" :inspection="info" />
        <p v-else-if="failed" role="status" class="text-sm text-muted-foreground">
          {{ t('datasets.inspectionFailed') }}
        </p>
      </section>
      <DatasetPreviewPanel :session="session" :selection="selection" />
    </div>
  </Card>
</template>
