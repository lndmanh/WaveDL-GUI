<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { CatalogApi, type ModelDescription, type ModelSelection } from '../../lib/catalog-api';
import ModelList from './ModelList.vue';
import { catalogMessages } from '../../i18n/catalog';
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
const { t, translateKnownMessage } = useWorkstationI18n(catalogMessages);
const props = defineProps<{
  session: ConnectionSession;
  inspection?: DatasetInspection | null;
  singleChannel?: boolean;
}>();
const emit = defineEmits<{ select: [selection: ModelSelection] }>();
const searchId = useId();
const models = shallowRef<readonly ModelDescription[]>([]);
const query = shallowRef('');
const busy = shallowRef(false);
const message = shallowRef('');
const page = shallowRef(0);
const filtered = computed(() =>
  models.value.filter((model) =>
    `${model.displayName} ${model.id} ${model.category} ${translateKnownMessage(model.category)}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
const visible = computed(() => filtered.value.slice(page.value * 20, (page.value + 1) * 20));
let revision = 0;
let request: AbortController | null = null;
let unsubscribe: (() => void) | undefined;
function cancel() {
  revision++;
  request?.abort();
  request = null;
  busy.value = false;
}
async function load() {
  cancel();
  const current = revision;
  request = new AbortController();
  busy.value = true;
  message.value = '';
  models.value = [];
  page.value = 0;
  try {
    const value = await new CatalogApi(toRaw(props.session)).models(request.signal);
    if (current === revision) models.value = value;
  } catch {
    if (current === revision)
      message.value = 'Model catalogue unavailable. Reconnect to the verified daemon and retry.';
  } finally {
    if (current === revision) {
      busy.value = false;
      request = null;
    }
  }
}
function select(model: ModelDescription) {
  try {
    emit('select', new CatalogApi(toRaw(props.session)).selectModel(model, models.value));
  } catch {
    models.value = [];
    message.value = 'Connection changed. Reload the catalogue before selecting.';
  }
}
watch(query, () => {
  page.value = 0;
});
watch(
  () => toRaw(props.session),
  (session) => {
    unsubscribe?.();
    cancel();
    models.value = [];
    let scope = -1;
    let connected = false;
    unsubscribe = session.subscribe((state) => {
      if (state.revision === scope && connected && state.status === 'connected') return;
      scope = state.revision;
      connected = state.status === 'connected';
      cancel();
      models.value = [];
      if (state.status === 'connected') {
        message.value = '';
        void load();
      } else if (state.status !== 'disconnected')
        message.value = 'Model catalogue unavailable. Reconnect to the verified daemon and retry.';
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  unsubscribe?.();
  cancel();
});
</script>
<template>
  <section class="flex flex-col gap-4" :aria-label="t('modelCatalog')">
    <h2>{{ t('chooseModel') }}</h2>
    <Alert
      ><AlertTitle>{{ t('certification') }}</AlertTitle
      ><AlertDescription>{{ t('modelSafety') }}</AlertDescription></Alert
    >
    <Field
      ><FieldLabel :for="searchId">{{ t('findModel') }}</FieldLabel
      ><Input :id="searchId" v-model="query" :disabled="busy" /><FieldDescription>{{
        t('searchHelp')
      }}</FieldDescription></Field
    >
    <Alert v-if="message" role="alert"
      ><AlertTitle>{{ t('catalogStatus') }}</AlertTitle
      ><AlertDescription>{{ translateKnownMessage(message) }}</AlertDescription></Alert
    >
    <p v-if="busy" role="status">{{ t('readingModels') }}</p>
    <ModelList
      :models="visible"
      :busy="busy"
      :inspection="inspection"
      :single-channel="singleChannel"
      @select="select"
    />
    <p v-if="!busy && !visible.length && !message" role="status">{{ t('noModels') }}</p>
    <div class="flex flex-wrap gap-3">
      <Button variant="outline" :disabled="busy || page === 0" @click="page--">{{
        t('previousModels')
      }}</Button>
      <Button
        variant="outline"
        :disabled="busy || (page + 1) * 20 >= filtered.length"
        @click="page++"
        >{{ t('nextModels') }}</Button
      >
      <Button variant="outline" :disabled="busy" @click="load">{{ t('reloadCatalog') }}</Button>
      <Button v-if="busy" variant="outline" @click="cancel">{{ t('stopLoading') }}</Button>
    </div>
  </section>
</template>
