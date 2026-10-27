<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { onBeforeUnmount, shallowRef, watch, toRaw } from 'vue';
import { useForm, Field as VeeField } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel, FieldError, FieldGroup } from '@/components/ui/field';
import InferenceFields from './InferenceFields.vue';
import { resultRequestSchema } from '../../../shared/schemas/result-request';
import type { ConnectionSession } from '../../lib/connection-session';
import type { Artifact } from '../../lib/artifact-client';
import type { DataSelection } from '../../lib/catalog-api';
import type { PlanView } from '../../lib/daemon-api';
import {
  ResultOperations,
  checkpointOptions,
  type CheckpointOption,
} from '../../lib/result-operations';
import { createResultOperationDefaults } from '../../lib/result-operation-defaults';
import BrowseContainer from '../catalog/BrowseContainer.vue';
import RuntimeFields from '../project/RuntimeFields.vue';
import EnvironmentFields from '../project/EnvironmentFields.vue';
import StorageMappingFields from '../project/StorageMappingFields.vue';
import PlanApproval from '../project/PlanApproval.vue';
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
function fieldMessage(message: string): string {
  return message.startsWith('results.') ? t(message) : clientMessage(message);
}
const props = defineProps<{ session: ConnectionSession; artifacts: readonly Artifact[] }>();
const session = toRaw(props.session);
const emit = defineEmits<{ runSelected: [runId: string] }>();
const workflow = new ResultOperations(props.session);
const data = shallowRef<DataSelection | null>(null);
const source = shallowRef<Artifact | null>(null);
const plan = shallowRef<PlanView | null>(null);
const busy = shallowRef(false);
const message = shallowRef('');
const sources = shallowRef<readonly CheckpointOption[]>([]);
const sourceMessage = shallowRef('');
const { handleSubmit, values, setFieldValue, setFieldError } = useForm({
  validationSchema: resultRequestSchema,
  initialValues: {
    ...createResultOperationDefaults(),
  },
});
let scope = new AbortController();
let epoch = 0;
function invalidate() {
  epoch++;
  scope.abort();
  scope = new AbortController();
  workflow.invalidate();
  plan.value = null;
  busy.value = false;
}
watch(values, invalidate, { deep: true });
watch(
  () => props.artifacts,
  async (_items, _prior, onCleanup) => {
    invalidate();
    source.value = null;
    sources.value = [];
    sourceMessage.value = 'results.verifying';
    const controller = new AbortController();
    const revision = session.snapshot().revision;
    onCleanup(() => controller.abort());
    try {
      const options = await checkpointOptions(session, props.artifacts, controller.signal);
      if (!controller.signal.aborted && session.api && session.snapshot().revision === revision) {
        sources.value = options;
        sourceMessage.value = options.length ? '' : 'results.noClassification';
      }
    } catch {
      if (!controller.signal.aborted) sourceMessage.value = 'results.classificationFailed';
    }
  },
  { immediate: true },
);
const unsubscribe = toRaw(props.session).subscribe((state) => {
  if (state.status !== 'connected') {
    invalidate();
    source.value = null;
    sources.value = [];
    data.value = null;
  }
});
function chooseSource(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const value = event.target.value;
  const selected = sources.value.find(
    (item) => item.selectable && item.artifact.generation === value,
  )?.artifact;
  source.value = selected ?? null;
  setFieldValue('checkpoint_source', {
    run_id: selected?.runId ?? '',
    generation: selected?.generation ?? '',
  });
}
function sourceLabel(item: CheckpointOption): string {
  const kind = item.classification.kind;
  const kindKeys: Readonly<Record<CheckpointOption['classification']['kind'], string>> = {
    best: 'results.best',
    periodic: 'results.periodic',
    interrupted: 'results.interrupted',
    cross_validation_fold: 'results.cvFold',
    cross_validation_summary: 'results.cvSummary',
  };
  return t('results.sourceLabel', {
    generation: item.artifact.generation,
    attempt: item.artifact.attempt,
    kind: t(kindKeys[kind]),
    fold: item.classification.fold === undefined ? '' : ` ${item.classification.fold}`,
  });
}
function chooseData(selected: DataSelection) {
  data.value = selected;
  setFieldValue('config.data_path', selected.path);
}
function exportValue(event: Event): 'onnx' | null {
  return event.target instanceof HTMLSelectElement && event.target.value === 'onnx' ? 'onnx' : null;
}
async function work(action: (signal: AbortSignal) => Promise<void>) {
  if (busy.value) return;
  const current = epoch;
  busy.value = true;
  message.value = '';
  try {
    await action(scope.signal);
  } catch {
    if (current === epoch) {
      message.value = 'results.unacknowledged';
      setFieldError('backend', 'results.settingsError');
    }
  } finally {
    if (current === epoch) busy.value = false;
  }
}
const preview = handleSubmit(async (draft) => {
  const selectedData = data.value;
  const selectedSource = source.value;
  if (!selectedData || !selectedSource) {
    message.value = 'results.selectionRequired';
    return;
  }
  await work(async (signal) => {
    await workflow.prepare(draft, selectedData, selectedSource, signal);
    plan.value = await workflow.preview(signal);
  });
});
async function submit() {
  await work(async (signal) => {
    const view = await workflow.submit(signal);
    emit('runSelected', view.run_id);
  });
}
async function status() {
  await work(async (signal) => {
    const view = await workflow.status(signal);
    emit('runSelected', view.run_id);
  });
}
onBeforeUnmount(() => {
  unsubscribe();
  invalidate();
});
</script>
<template>
  <section class="flex flex-col gap-5 border-t pt-6" aria-labelledby="inference-title">
    <h2 id="inference-title" class="text-xl font-semibold">{{ t('results.evaluatePlots') }}</h2>
    <p class="text-sm text-muted-foreground">{{ t('results.sourceHelp') }}</p>
    <BrowseContainer :session="session" @select="chooseData" />
    <form class="flex flex-col gap-5" @submit.prevent="preview">
      <FieldGroup>
        <Field
          ><FieldLabel for="source-generation">{{ t('results.sourceGeneration') }}</FieldLabel
          ><select id="source-generation" :disabled="busy" @change="chooseSource">
            <option value="">{{ t('results.choosePublication') }}</option>
            <option
              v-for="item in sources"
              :key="item.artifact.generation"
              :value="item.artifact.generation"
              :disabled="!item.selectable"
            >
              {{ sourceLabel(item) }}
            </option>
          </select></Field
        >
        <VeeField v-slot="{ field, errors }" name="operation"
          ><Field :data-invalid="!!errors.length"
            ><FieldLabel for="result-operation">{{ t('results.operation') }}</FieldLabel
            ><select
              id="result-operation"
              v-bind="field"
              :disabled="busy"
              :aria-invalid="!!errors.length"
            >
              <option value="test">{{ t('results.evaluate') }}</option>
              <option value="plot">{{ t('results.generatePlots') }}</option></select
            ><FieldError v-if="errors.length" :errors="errors.map(fieldMessage)" /></Field
        ></VeeField>
        <VeeField v-slot="{ field, errors }" name="config.export"
          ><Field :data-invalid="!!errors.length"
            ><FieldLabel for="result-export">{{ t('results.modelExport') }}</FieldLabel
            ><select
              id="result-export"
              :value="field.value ?? ''"
              :disabled="busy"
              :aria-invalid="!!errors.length"
              @change="field.onChange(exportValue($event))"
            >
              <option value="">{{ t('results.none') }}</option>
              <option value="onnx">ONNX</option></select
            ><FieldError v-if="errors.length" :errors="errors.map(fieldMessage)" /></Field
        ></VeeField>
        <InferenceFields :disabled="busy" />
        <RuntimeFields :disabled="busy" />
        <EnvironmentFields
          :disabled="busy"
          :environment="values.runtime.environment"
          @update="setFieldValue('runtime.environment', $event)"
        />
        <StorageMappingFields
          :mappings="values.storage_map"
          :backend="values.backend"
          :disabled="busy"
          @update="setFieldValue('storage_map', $event)"
        />
      </FieldGroup>
      <p v-if="sourceMessage" role="status">{{ t(sourceMessage) }}</p>
      <Button type="submit" :disabled="busy || !session.api">{{ t('results.previewPlan') }}</Button>
    </form>
    <p v-if="message" role="alert">
      {{ typeof message === 'string' ? fieldMessage(message) : clientMessage(message) }}
    </p>
    <PlanApproval v-if="plan" :plan="plan" :busy="busy" @submit="submit" @status="status" />
  </section>
</template>
