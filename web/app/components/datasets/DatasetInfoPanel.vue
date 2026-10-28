<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onBeforeUnmount, shallowRef, toRaw, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import InfoChip from '../common/InfoChip.vue';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '../../lib/catalog-api';
import { DatasetInspectionApi, type DatasetInspection } from '../../lib/dataset-inspection';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps<{ session: ConnectionSession; selection: DataSelection | null }>();
const emit = defineEmits<{
  inspected: [inspection: DatasetInspection | null, selection: DataSelection | null];
}>();
const info = shallowRef<DatasetInspection | null>(null);
const busy = shallowRef(false);
const connected = shallowRef(false);
const message = shallowRef<'' | 'datasets.inspectionReconnect' | 'datasets.inspectionUnavailable'>(
  '',
);
let controller: AbortController | null = null;
let sequence = 0;
let unsubscribe: (() => void) | undefined;
function clear() {
  sequence++;
  controller?.abort();
  controller = null;
  info.value = null;
  emit('inspected', null, props.selection ? toRaw(props.selection) : null);
  busy.value = false;
}
async function load() {
  clear();
  message.value = '';
  const selection = props.selection ? toRaw(props.selection) : null;
  if (!selection) return;
  if (!connected.value) {
    message.value = 'datasets.inspectionReconnect';
    return;
  }
  const current = sequence;
  const request = new AbortController();
  controller = request;
  busy.value = true;
  try {
    const result = await new DatasetInspectionApi(toRaw(props.session)).inspect(
      selection,
      request.signal,
    );
    if (current === sequence && !request.signal.aborted) {
      info.value = result;
      emit('inspected', result, selection);
    }
  } catch {
    if (current === sequence && !request.signal.aborted)
      message.value = 'datasets.inspectionUnavailable';
  } finally {
    if (current === sequence) {
      busy.value = false;
      controller = null;
    }
  }
}
watch(
  () => props.session,
  (session) => {
    unsubscribe?.();
    clear();
    let revision = toRaw(session).snapshot().revision;
    unsubscribe = toRaw(session).subscribe((state) => {
      connected.value = state.status === 'connected';
      if (state.revision !== revision || !connected.value) {
        revision = state.revision;
        clear();
        message.value = 'datasets.inspectionReconnect';
      }
    });
  },
  { immediate: true },
);
watch(() => [props.selection, props.session], load, { immediate: true });
onBeforeUnmount(() => {
  unsubscribe?.();
  clear();
});
</script>

<template>
  <section class="flex min-w-0 flex-col gap-4" :aria-label="t('datasets.headerTitle')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3>{{ t('datasets.headerTitle') }}</h3>
      <Button
        variant="outline"
        size="sm"
        :disabled="!selection || !connected || busy"
        @click="load"
        >{{ t('datasets.refreshHeader') }}</Button
      >
      <Button v-if="busy" variant="ghost" size="sm" @click="clear">{{
        t('datasets.stopInspecting')
      }}</Button>
    </div>
    <InfoChip :label="t('datasets.headerDetails')" :text="t('datasets.headerHelp')" />
    <p v-if="busy" role="status">{{ t('datasets.headerLoading') }}</p>
    <div v-else-if="message" role="status">
      <InfoChip
        :label="t(message)"
        :text="
          message === 'datasets.inspectionUnavailable'
            ? t('datasets.inspectionDetails')
            : t(message)
        "
        uncertain
      />
    </div>
    <p v-else-if="!selection" role="status">{{ t('datasets.chooseDataset') }}</p>
    <dl v-if="info" class="flex flex-wrap gap-2" :aria-label="t('datasets.infoChips')">
      <dt class="sr-only">{{ t('datasets.format') }}</dt>
      <dd>
        <Badge variant="outline">{{ info.format.toUpperCase() }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.samples') }}</dt>
      <dd>
        <Badge variant="outline">{{ info.numSamples }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.fileSize') }}</dt>
      <dd>
        <Badge variant="outline">{{ t('datasets.unknown') }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.inputKey') }}</dt>
      <dd>
        <Badge variant="secondary">{{ info.inputKey }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.inputShape') }}</dt>
      <dd>
        <Badge variant="secondary">{{ info.inputShape.join(' × ') || t('datasets.scalar') }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.inputDtype') }}</dt>
      <dd>
        <Badge variant="secondary">{{ info.inputDtype }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.outputKey') }}</dt>
      <dd>
        <Badge variant="secondary">{{ info.outputKey }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.outputShape') }}</dt>
      <dd>
        <Badge variant="secondary">{{
          info.outputShape.join(' × ') || t('datasets.scalar')
        }}</Badge>
      </dd>
      <dt class="sr-only">{{ t('datasets.outputDtype') }}</dt>
      <dd>
        <Badge variant="secondary">{{ info.outputDtype }}</Badge>
      </dd>
    </dl>
    <p v-if="selection" class="break-all text-xs text-muted-foreground">
      {{ selection.relativePath }}
    </p>
  </section>
</template>
