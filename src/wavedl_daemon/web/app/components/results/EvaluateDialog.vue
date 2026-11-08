<script setup lang="ts">
import { Field as VeeField, useForm } from 'vee-validate';
import { ChevronDown, FolderOpen } from '@lucide/vue';
import { cn } from '@/lib/utils';
import { resultRequestSchema } from '../../../shared/schemas/result-request';
import { ResultOperations } from '../../lib/result-operations';
import { createResultOperationDefaults } from '../../lib/result-operation-defaults';
import {
  resultOperationPrefill,
  type ResultPrefillWarning,
} from '../../lib/result-operation-prefill';
import { pathName } from '../../lib/run-overview';
import type { ConnectionSession } from '../../lib/connection-session';
import type { Checkpoint } from '~~/types/artifact-client';
import type { DataSelection } from '~~/types/catalog-api';

const props = defineProps<{
  open: boolean;
  session: ConnectionSession;
  runId: string;
  runName: string;
  checkpoints: readonly Checkpoint[];
  checkpoint?: string;
  mode: 'evaluate' | 'export';
  focusTarget?: HTMLElement | null;
}>();

const emit = defineEmits<{ 'update:open': [open: boolean]; runSelected: [runId: string] }>();
const { t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
const session = toRaw(props.session);
const workflow = new ResultOperations(session);
const source = shallowRef<Checkpoint | null>(null);
const data = shallowRef<DataSelection | null>(null);
const advanced = shallowRef(false);
const pickerOpen = shallowRef(false);
const loading = shallowRef(false);
const busy = shallowRef(false);
const connected = shallowRef(!!session.api);
const warnings = shallowRef<ResultPrefillWarning[]>([]);
const message = shallowRef('');
const recovery = shallowRef(false);
const id = useId();
let scope = new AbortController();
let generation = 0;
let trigger: HTMLElement | null = null;
const { isActive } = usePageActive();

const styles = {
  content: cn('max-h-[90dvh] overflow-y-auto sm:max-w-2xl'),
  form: cn('flex min-w-0 flex-col gap-5'),
  advanced: cn(
    'flex w-full flex-wrap items-center gap-2 rounded-lg py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
  ),
};

const { values, handleSubmit, resetForm, setFieldValue } = useForm({
  validationSchema: resultRequestSchema,
  initialValues: createResultOperationDefaults(),
  keepValuesOnUnmount: true,
});

function sourceLabel(item: Checkpoint): string {
  if (item.name === 'best_checkpoint') return t('results.versionBest');

  if (item.name === 'interrupted_checkpoint') return t('results.versionInterrupted');

  return t('results.versionEpoch', {
    epoch: item.name.match(/^epoch_([0-9]+)_checkpoint$/)?.[1] ?? '',
  });
}

const versions = computed(() =>
  props.checkpoints.map((item) => ({ value: item.name, label: sourceLabel(item) })),
);

const outputSwitches = computed(() =>
  props.mode === 'evaluate'
    ? [
        {
          name: 'config.plot',
          label: t('results.includePlots'),
          description: t('results.includePlotsHelp'),
        },
        {
          name: 'config.save_predictions',
          label: t('results.savePredictions'),
          description: t('results.savePredictionsHelp'),
        },
      ]
    : [
        {
          name: 'config.no_denorm',
          label: t('results.exportNormalized'),
          description: t('results.exportNormalizedHelp'),
        },
      ],
);

const summary = computed(() =>
  [
    source.value ? sourceLabel(source.value) : t('results.chooseCheckpoint'),
    data.value ? pathName(data.value.path) : t('results.chooseTestData'),
    values.runtime.device,
  ].join(' · '),
);

const warningKeys = {
  plan: 'results.prefillPlanWarning',
  paths: 'results.prefillPathsWarning',
  runtime: 'results.prefillRuntimeWarning',
  container: 'results.prefillContainerWarning',
  config: 'results.prefillConfigWarning',
};

function chooseSource(name: string) {
  source.value = props.checkpoints.find((item) => item.name === name) ?? null;
  setFieldValue('checkpoint_source', {
    run_id: source.value?.runId ?? '',
    checkpoint: source.value?.name ?? '',
  });
}

function chooseData(selection: DataSelection) {
  if (selection.kind !== 'file') return;
  data.value = selection;
  setFieldValue('config.data_path', selection.path);
  pickerOpen.value = false;
}

function invalidate() {
  generation++;
  scope.abort();
  scope = new AbortController();
  workflow.invalidate();
  busy.value = false;
  loading.value = false;
  recovery.value = false;
}

watch(
  values,
  () => {
    workflow.invalidate();
    recovery.value = false;
    message.value = '';
  },
  { deep: true, flush: 'sync' },
);

async function initialize() {
  invalidate();
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const current = generation;
  data.value = null;
  warnings.value = [];
  message.value = '';
  advanced.value = false;
  pickerOpen.value = false;
  resetForm({ values: createResultOperationDefaults() });
  loading.value = true;
  let prefill = resultOperationPrefill(null);

  try {
    const plan = await session.perform((api, signal) => api.getRunPlan(props.runId, signal), {
      signal: scope.signal,
    });

    prefill = resultOperationPrefill(plan);
  } catch {
    // Missing or unreadable saved plans still permit an explicit manual setup.
  }

  if (current !== generation || !props.open) return;
  const draft = prefill.draft;
  draft.operation = 'test';
  draft.config.plot = props.mode === 'evaluate';
  draft.config.save_predictions = false;
  draft.config.export = props.mode === 'export' ? 'onnx' : null;
  draft.config.export_opset = 17;
  draft.config.no_denorm = false;
  resetForm({ values: draft });
  chooseSource(
    props.checkpoint ??
      props.checkpoints.find((item) => item.name === 'best_checkpoint')?.name ??
      props.checkpoints[0]?.name ??
      '',
  );
  warnings.value = prefill.warnings;
  advanced.value = prefill.warnings.length > 0;
  loading.value = false;
}

watch(
  [() => props.open, isActive],
  ([open, active]) => {
    if (open && active) void initialize();
    else invalidate();
  },
  { immediate: true, flush: 'sync' },
);

const unsubscribe = session.subscribe((state) => {
  connected.value = state.status === 'connected';

  if (!connected.value) {
    invalidate();
    data.value = null;
    source.value = null;
  }
});

function finish(runId: string) {
  emit('update:open', false);
  emit('runSelected', runId);
}

const submit = handleSubmit(
  async (draft) => {
    if (busy.value || loading.value || !connected.value || !data.value || !source.value) return;
    const current = generation;
    busy.value = true;
    message.value = '';

    try {
      workflow.prepare(draft, data.value, source.value);
      await workflow.preview(scope.signal);
      const run = await workflow.submit(scope.signal);

      if (current === generation) finish(run.run_id);
    } catch (error) {
      if (current !== generation) return;
      recovery.value = workflow.approved !== null;
      message.value = error instanceof Error ? clientMessage(error) : t('results.settingsError');
    } finally {
      if (current === generation) busy.value = false;
    }
  },
  () => {
    advanced.value = true;
  },
);

async function status() {
  if (busy.value) return;
  const current = generation;
  busy.value = true;

  try {
    const run = await workflow.status(scope.signal);

    if (current === generation) finish(run.run_id);
  } catch (error) {
    if (current === generation)
      message.value = error instanceof Error ? clientMessage(error) : t('results.unacknowledged');
  } finally {
    if (current === generation) busy.value = false;
  }
}

function changeOpen(open: boolean) {
  if (!busy.value) emit('update:open', open);
}

function restoreFocus(event: Event) {
  if (!isActive.value) {
    event.preventDefault();

    return;
  }

  const target = trigger?.isConnected ? trigger : props.focusTarget;

  if (!target?.isConnected) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
}

onBeforeUnmount(() => {
  unsubscribe();
  invalidate();
});
</script>

<template>
  <Dialog :open="open" @update:open="changeOpen">
    <DialogContent :class="styles.content" @close-auto-focus="restoreFocus">
      <DialogHeader>
        <DialogTitle>{{
          t(mode === 'export' ? 'results.exportTitle' : 'results.evaluateTitle', { name: runName })
        }}</DialogTitle>
        <DialogDescription>{{
          t(mode === 'export' ? 'results.exportDescription' : 'results.evaluateDescription')
        }}</DialogDescription>
      </DialogHeader>
      <form :class="styles.form" @submit.prevent="submit">
        <fieldset :disabled="busy || loading || recovery" class="flex min-w-0 flex-col gap-5">
          <Field>
            <FieldLabel :for="`${id}-version`">{{ t('results.modelVersion') }}</FieldLabel>
            <SegmentedControl
              :id="`${id}-version`"
              :model-value="source?.name"
              :options="versions"
              :label="t('results.modelVersion')"
              :disabled="busy || loading || recovery || mode === 'export'"
              @update:model-value="chooseSource"
            />
          </Field>
          <VeeField v-slot="{ errors }" name="config.data_path">
            <Field :data-invalid="!!errors.length">
              <FieldLabel :for="`${id}-data`">{{ t('results.testData') }}</FieldLabel>
              <Popover v-model:open="pickerOpen">
                <PopoverTrigger as-child>
                  <Button
                    :id="`${id}-data`"
                    type="button"
                    variant="outline"
                    class="w-full min-w-0 justify-start"
                    :disabled="busy || loading || recovery || !connected"
                    :aria-invalid="!!errors.length"
                  >
                    <FolderOpen aria-hidden="true" /><span class="truncate">{{
                      data ? pathName(data.path) : t('results.chooseTestData')
                    }}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  class="max-h-[75dvh] w-[min(54rem,calc(100vw-2rem))] overflow-y-auto p-3"
                  align="start"
                >
                  <DatasetPathPicker
                    :session="session"
                    :selected="data"
                    :label="t('results.testData')"
                    immediate
                    @select="chooseData"
                  />
                </PopoverContent>
              </Popover>
              <FieldDescription v-if="data" class="break-all">{{ data.path }}</FieldDescription>
              <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
            </Field>
          </VeeField>
          <VeeField v-if="mode === 'export'" v-slot="{ field, errors }" name="config.export_opset">
            <Field :data-invalid="!!errors.length">
              <FieldLabel :for="`${id}-opset`">{{ t('results.opset') }}</FieldLabel>
              <Input
                :id="`${id}-opset`"
                type="number"
                min="11"
                max="17"
                :model-value="field.value"
                :aria-invalid="!!errors.length"
                @update:model-value="field.onChange($event === '' ? Number.NaN : Number($event))"
                @blur="field.onBlur"
              />
              <FieldError v-if="errors.length" :errors="errors.map(clientMessage)" />
            </Field>
          </VeeField>
          <VeeField
            v-for="item in outputSwitches"
            :key="item.name"
            v-slot="{ field, errors }"
            :name="item.name"
          >
            <Field orientation="horizontal" :data-invalid="!!errors.length">
              <FieldContent
                ><FieldLabel :for="`${id}-${item.name}`">{{ item.label }}</FieldLabel
                ><FieldDescription>{{ item.description }}</FieldDescription
                ><FieldError v-if="errors.length" :errors="errors.map(clientMessage)"
              /></FieldContent>
              <Switch
                :id="`${id}-${item.name}`"
                :model-value="field.value"
                :disabled="busy || loading || recovery"
                :aria-invalid="!!errors.length"
                @update:model-value="field.onChange"
              />
            </Field>
          </VeeField>
          <Alert v-if="warnings.length" variant="warning" role="status">
            <AlertDescription
              ><p v-for="warning in warnings" :key="warning">
                {{ t(warningKeys[warning]) }}
              </p></AlertDescription
            >
          </Alert>
          <Collapsible v-model:open="advanced" class="border-t pt-2">
            <CollapsibleTrigger :class="styles.advanced">
              <ChevronDown
                class="size-4 transition-transform motion-reduce:transition-none"
                :class="advanced && 'rotate-180'"
                aria-hidden="true"
              />
              <span class="font-medium">{{ t('results.advanced') }}</span
              ><span class="text-xs text-muted-foreground">{{
                t(warnings.length ? 'results.reviewSettings' : 'results.sameAsTraining')
              }}</span>
            </CollapsibleTrigger>
            <CollapsibleContent class="pt-4">
              <FieldGroup>
                <InferenceFields :disabled="busy || loading || recovery" />
                <RuntimeFields :disabled="busy || loading || recovery" />
                <EnvironmentFields
                  :disabled="busy || loading || recovery"
                  :environment="values.runtime.environment"
                  @update="setFieldValue('runtime.environment', $event)"
                />
                <StorageMappingFields
                  :disabled="busy || loading || recovery"
                  :mappings="values.storage_map"
                  :backend="values.backend"
                  @update="setFieldValue('storage_map', $event)"
                />
              </FieldGroup>
            </CollapsibleContent>
          </Collapsible>
        </fieldset>
        <p v-if="loading" role="status" class="text-sm text-muted-foreground">
          {{ t('results.loadingSettings') }}
        </p>
        <Alert v-if="message" variant="warning" role="alert">
          <AlertDescription
            ><p>{{ message }}</p>
            <p v-if="recovery">{{ t('results.unacknowledged') }}</p></AlertDescription
          >
        </Alert>
        <div class="border-t pt-4">
          <p class="mb-4 break-words text-xs text-muted-foreground">{{ summary }}</p>
          <DialogFooter>
            <Button type="button" variant="outline" :disabled="busy" @click="changeOpen(false)">{{
              t('results.cancel')
            }}</Button>
            <Button
              v-if="recovery"
              type="button"
              variant="outline"
              :disabled="busy || !connected"
              @click="status"
              >{{ t('results.checkStatus') }}</Button
            >
            <Button type="submit" :disabled="busy || loading || !data || !source || !connected">{{
              busy
                ? t('results.working')
                : t(mode === 'export' ? 'results.exportOnnx' : 'results.runEvaluation')
            }}</Button>
          </DialogFooter>
        </div>
      </form>
    </DialogContent>
  </Dialog>
</template>
