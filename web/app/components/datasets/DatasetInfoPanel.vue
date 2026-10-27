<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { datasetMessages } from '../../i18n/datasets';
import { onBeforeUnmount, shallowRef, toRaw, watch } from 'vue';
import { Button } from '@/components/ui/button';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DataSelection } from '../../lib/catalog-api';
import { DatasetInspectionApi, type DatasetInspection } from '../../lib/dataset-inspection';

const { t, translateKnownMessage } = useWorkstationI18n(datasetMessages);

const props = defineProps<{ session: ConnectionSession; selection: DataSelection | null }>();
const emit = defineEmits<{
  inspected: [inspection: DatasetInspection | null, selection: DataSelection | null];
}>();
const info = shallowRef<DatasetInspection | null>(null);
const busy = shallowRef(false);
const connected = shallowRef(false);
const message = shallowRef('');
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
    message.value = 'Reconnect and select this dataset again to inspect its header.';
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
      message.value =
        'Dataset inspection refused or unavailable. Reconnect, select a supported dataset again, or retry its header inspection.';
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
        message.value = 'Reconnect and select this dataset again to inspect its header.';
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
  <section class="flex min-w-0 flex-col gap-4" :aria-label="t('headerTitle')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3>{{ t('headerTitle') }}</h3>
      <Button
        variant="outline"
        size="sm"
        :disabled="!selection || !connected || busy"
        @click="load"
        >{{ t('refreshHeader') }}</Button
      >
      <Button v-if="busy" variant="ghost" size="sm" @click="clear">{{
        t('stopInspecting')
      }}</Button>
    </div>
    <p class="text-sm text-muted-foreground">
      {{ t('headerHelp') }}
    </p>
    <p v-if="busy" role="status">{{ t('headerLoading') }}</p>
    <p v-else-if="message" role="status">{{ translateKnownMessage(message) }}</p>
    <p v-else-if="!selection" role="status">{{ t('chooseDataset') }}</p>
    <dl v-if="info" class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
      <dt>{{ t('format') }}</dt>
      <dd>{{ info.format.toUpperCase() }}</dd>
      <dt>{{ t('samples') }}</dt>
      <dd>{{ info.numSamples }}</dd>
      <dt>{{ t('fileSize') }}</dt>
      <dd>{{ t('unknown') }}</dd>
      <dt>{{ t('inputKey') }}</dt>
      <dd>{{ info.inputKey }}</dd>
      <dt>{{ t('inputShape') }}</dt>
      <dd>{{ info.inputShape.join(' × ') || t('scalar') }}</dd>
      <dt>{{ t('inputDtype') }}</dt>
      <dd>{{ info.inputDtype }}</dd>
      <dt>{{ t('outputKey') }}</dt>
      <dd>{{ info.outputKey }}</dd>
      <dt>{{ t('outputShape') }}</dt>
      <dd>{{ info.outputShape.join(' × ') }}</dd>
      <dt>{{ t('outputDtype') }}</dt>
      <dd>{{ info.outputDtype }}</dd>
    </dl>
  </section>
</template>
