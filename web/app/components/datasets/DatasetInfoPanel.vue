<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { onBeforeUnmount, shallowRef, toRaw, watch } from 'vue';
import { Button } from '@/components/ui/button';
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
    <p class="text-sm text-muted-foreground">
      {{ t('datasets.headerHelp') }}
    </p>
    <p v-if="busy" role="status">{{ t('datasets.headerLoading') }}</p>
    <p v-else-if="message" role="status">{{ t(message) }}</p>
    <p v-else-if="!selection" role="status">{{ t('datasets.chooseDataset') }}</p>
    <dl v-if="info" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
      <dt>{{ t('datasets.format') }}</dt>
      <dd>{{ info.format.toUpperCase() }}</dd>
      <dt>{{ t('datasets.samples') }}</dt>
      <dd>{{ info.numSamples }}</dd>
      <dt>{{ t('datasets.fileSize') }}</dt>
      <dd>{{ t('datasets.unknown') }}</dd>
      <dt>{{ t('datasets.inputKey') }}</dt>
      <dd>{{ info.inputKey }}</dd>
      <dt>{{ t('datasets.inputShape') }}</dt>
      <dd>{{ info.inputShape.join(' × ') || t('datasets.scalar') }}</dd>
      <dt>{{ t('datasets.inputDtype') }}</dt>
      <dd>{{ info.inputDtype }}</dd>
      <dt>{{ t('datasets.outputKey') }}</dt>
      <dd>{{ info.outputKey }}</dd>
      <dt>{{ t('datasets.outputShape') }}</dt>
      <dd>{{ info.outputShape.join(' × ') }}</dd>
      <dt>{{ t('datasets.outputDtype') }}</dt>
      <dd>{{ info.outputDtype }}</dd>
    </dl>
  </section>
</template>
