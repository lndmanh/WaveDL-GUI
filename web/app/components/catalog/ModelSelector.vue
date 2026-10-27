<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, toRaw, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ConnectionSession } from '../../lib/connection-session';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import { CatalogApi, type ModelDescription, type ModelSelection } from '../../lib/catalog-api';
import ModelList from './ModelList.vue';
import { modelCategoryMessageKeys } from '../../i18n/dynamic-keys';
const { t } = useI18n({ useScope: 'global' });
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
const message = shallowRef<'' | 'catalog.modelsUnavailable' | 'catalog.connectionChanged'>('');
function categoryLabel(category: string): string {
  const key = modelCategoryMessageKeys[category as keyof typeof modelCategoryMessageKeys];
  return key ? t(key) : category;
}
const page = shallowRef(0);
const filtered = computed(() =>
  models.value.filter((model) =>
    `${model.displayName} ${model.id} ${model.category} ${categoryLabel(model.category)}`
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
    if (current === revision) message.value = 'catalog.modelsUnavailable';
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
    message.value = 'catalog.connectionChanged';
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
      } else if (state.status !== 'disconnected') message.value = 'catalog.modelsUnavailable';
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
  <section class="flex flex-col gap-4" :aria-label="t('catalog.modelCatalog')">
    <h2>{{ t('catalog.chooseModel') }}</h2>
    <Alert
      ><AlertTitle>{{ t('catalog.certification') }}</AlertTitle
      ><AlertDescription>{{ t('catalog.modelSafety') }}</AlertDescription></Alert
    >
    <Field
      ><FieldLabel :for="searchId">{{ t('catalog.findModel') }}</FieldLabel
      ><Input :id="searchId" v-model="query" :disabled="busy" /><FieldDescription>{{
        t('catalog.searchHelp')
      }}</FieldDescription></Field
    >
    <Alert v-if="message" role="alert"
      ><AlertTitle>{{ t('catalog.catalogStatus') }}</AlertTitle
      ><AlertDescription>{{ t(message) }}</AlertDescription></Alert
    >
    <p v-if="busy" role="status">{{ t('catalog.readingModels') }}</p>
    <ModelList
      :models="visible"
      :busy="busy"
      :inspection="inspection"
      :single-channel="singleChannel"
      @select="select"
    />
    <p v-if="!busy && !visible.length && !message" role="status">{{ t('catalog.noModels') }}</p>
    <div class="flex flex-wrap gap-3">
      <Button variant="outline" :disabled="busy || page === 0" @click="page--">{{
        t('catalog.previousModels')
      }}</Button>
      <Button
        variant="outline"
        :disabled="busy || (page + 1) * 20 >= filtered.length"
        @click="page++"
        >{{ t('catalog.nextModels') }}</Button
      >
      <Button variant="outline" :disabled="busy" @click="load">{{
        t('catalog.reloadCatalog')
      }}</Button>
      <Button v-if="busy" variant="outline" @click="cancel">{{ t('catalog.stopLoading') }}</Button>
    </div>
  </section>
</template>
