<script setup lang="ts">
import { useWorkstationI18n } from '../../composables/useWorkstationI18n';
import { projectMessages } from '../../i18n/project';
import { runMessages } from '../../i18n/runs';
import DatasetInfoPanel from '../datasets/DatasetInfoPanel.vue';
import { computed, onBeforeUnmount, shallowRef, watch, toRaw } from 'vue';
import { useForm } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  trainingDefaults,
  trainingRequestSchema,
  type TrainingRequest,
} from '../../../shared/schemas/training-request';
import { ConnectionSessionError, type ConnectionSession } from '../../lib/connection-session';
import {
  applyTrainingPreferences,
  loadAppearance,
  loadTrainingPreferences,
} from '../../lib/preferences';
import type { PlanView, RunView } from '../../lib/daemon-api';
import { CatalogApi, type DataSelection, type ModelSelection } from '../../lib/catalog-api';
import { ProjectPlan } from '../../lib/project-plan';
import type { DatasetInspection } from '../../lib/dataset-inspection';
import BrowseContainer from '../catalog/BrowseContainer.vue';
import ModelSelector from '../catalog/ModelSelector.vue';
import TrainingFields from './TrainingFields.vue';
import RuntimeFields from './RuntimeFields.vue';
import EnvironmentFields from './EnvironmentFields.vue';
import StorageMappingFields from './StorageMappingFields.vue';
import PlanApproval from './PlanApproval.vue';
import TrainingExport from './TrainingExport.vue';
import CustomModelSelector from './CustomModelSelector.vue';
import TrainingPresets from './TrainingPresets.vue';
import ProjectGuide from './ProjectGuide.vue';
import { applyTrainingPreset, trainingPresetSchema } from '../../lib/training-presets';
import type { z } from 'zod';

const { locale, t, translateKnownMessage } = useWorkstationI18n(projectMessages);
const { t: runMessage } = useWorkstationI18n(runMessages);
function stateLabel(state: RunView['state']): string {
  if (locale.value === 'en') return state;
  switch (state) {
    case 'submission_unknown':
      return runMessage('submissionUnknown');
    case 'terminal_unknown':
      return runMessage('terminalUnknown');
    case 'observation_unavailable':
      return runMessage('observationUnavailable');
    case 'supervision_lost':
      return runMessage('supervisionLost');
    default:
      return runMessage(state);
  }
}
const props = defineProps<{ session: ConnectionSession }>();
const emit = defineEmits<{
  submitted: [run: RunView];
  submittedPlan: [run: RunView, plan: PlanView];
}>();
function defaults(): TrainingRequest {
  const daemonId = toRaw(props.session).snapshot().health?.daemon_id;
  return {
    backend: 'local',
    operation: 'train',
    config: daemonId
      ? applyTrainingPreferences(
          structuredClone(trainingDefaults),
          loadTrainingPreferences(daemonId),
        )
      : structuredClone(trainingDefaults),
    runtime: { python: '', mode: 'existing', device: 'cpu', environment: {} },
    topology: { num_machines: 1, processes_per_machine: 1, machine_rank: 0 },
  };
}
const { handleSubmit, values, setFieldValue, resetForm, validate } = useForm<TrainingRequest>({
  initialValues: defaults(),
  validationSchema: trainingRequestSchema,
  keepValuesOnUnmount: true,
});
const data = shallowRef<DataSelection | null>(null);
const datasetInspection = shallowRef<DatasetInspection | null>(null);
const model = shallowRef<ModelSelection | null>(null);
const plan = shallowRef<PlanView | null>(null);
const acknowledged = shallowRef<RunView | null>(null);
const busy = shallowRef(false);
const message = shallowRef('');
const reportedRun = shallowRef<RunView | null>(null);
const displayMessage = computed(() =>
  message.value === 'reported' && reportedRun.value
    ? t('Daemon reports {state}{submission}.', {
        state: stateLabel(reportedRun.value.state),
        submission: translateKnownMessage(
          reportedRun.value.submission_requested ? '; submission requested' : '; not submitted yet',
        ),
      })
    : translateKnownMessage(message.value),
);
const connected = shallowRef(false);
const resetConfirmation = shallowRef(false);
const guided = shallowRef(loadAppearance().showProjectGuide);
const step = shallowRef(0);
const advancing = shallowRef(false);
const canPreview = computed(
  () => connected.value && !!data.value && !!model.value && !busy.value && !advancing.value,
);
let workflow = new ProjectPlan(props.session);
let pending: AbortController | null = null;
let epoch = 0;
let unsubscribe: (() => void) | undefined;
function invalidate() {
  epoch++;
  pending?.abort();
  pending = null;
  busy.value = false;
  advancing.value = false;
  plan.value = null;
  workflow.invalidate();
}
function retireScope() {
  invalidate();
  data.value = null;
  datasetInspection.value = null;
  model.value = null;
  acknowledged.value = null;
  reportedRun.value = null;
  message.value = '';
  resetConfirmation.value = false;
  step.value = 0;
}
watch(values, invalidate, { deep: true, flush: 'sync' });
watch(
  () => props.session,
  (session) => {
    unsubscribe?.();
    retireScope();
    workflow = new ProjectPlan(session);
    let revision = -1;
    unsubscribe = toRaw(session).subscribe((state) => {
      if (toRaw(props.session) !== toRaw(session)) return;
      connected.value = state.status === 'connected';
      if (state.revision !== revision || !connected.value) {
        revision = state.revision;
        retireScope();
      }
    });
  },
  { immediate: true, flush: 'sync' },
);
function selectData(selection: DataSelection) {
  try {
    new CatalogApi(toRaw(props.session)).assertSelection(selection);
  } catch {
    return;
  }
  data.value = selection;
  datasetInspection.value = null;
  setFieldValue('config.data_path', selection.path);
}
function inspectData(inspection: DatasetInspection | null, selection: DataSelection | null) {
  if (!selection || selection !== toRaw(data.value)) return;
  try {
    new CatalogApi(toRaw(props.session)).assertSelection(selection);
  } catch {
    return;
  }
  datasetInspection.value = inspection;
}
function selectModel(selection: ModelSelection) {
  try {
    new CatalogApi(toRaw(props.session)).assertSelection(selection);
  } catch {
    return;
  }
  model.value = selection;
  setFieldValue('config.model', selection.model);
}
function applyPreset(preset: z.infer<typeof trainingPresetSchema>) {
  setFieldValue('config', applyTrainingPreset(values.config, preset));
}
async function nextStep() {
  if (busy.value || advancing.value) return;
  const current = epoch;
  const currentStep = step.value;
  if (step.value === 0 && !data.value) {
    message.value = 'Choose a dataset from the current daemon.';
    return;
  }
  if (step.value === 1 && !model.value) {
    message.value = 'Choose a catalogue model or explicit custom identifier.';
    return;
  }
  if (step.value === 3) {
    advancing.value = true;
    try {
      const result = await validate();
      if (current !== epoch || step.value !== currentStep) return;
      if (!result.valid) {
        message.value = 'Review training and runtime validation errors before approval.';
        return;
      }
    } finally {
      if (current === epoch) advancing.value = false;
    }
  }
  step.value = Math.min(step.value + 1, 4);
  message.value = '';
}
type WorkOperation = 'preview' | 'submit' | 'status';
async function work(
  operation: WorkOperation,
  action: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>,
) {
  const current = ++epoch;
  advancing.value = false;
  pending?.abort();
  pending = new AbortController();
  busy.value = true;
  message.value = '';
  try {
    await action(pending.signal, () => current === epoch);
  } catch (error) {
    if (current === epoch) {
      message.value =
        operation === 'preview' &&
        error instanceof ConnectionSessionError &&
        error.code === 'request' &&
        error.status === 400
          ? 'The daemon refused this plan. Correct the settings and preview again.'
          : 'The request was not acknowledged; server work may already exist. Reconnect if needed, then retry preview with this unchanged draft, or check/retry the approved submission. Never create a replacement draft merely to retry.';
    }
  } finally {
    if (current === epoch) {
      busy.value = false;
      pending = null;
    }
  }
}
function preview(event?: Event) {
  const current = epoch;
  return handleSubmit(
    async (draft) => {
      if (current !== epoch) return;
      if (!data.value || !model.value) {
        message.value = 'Choose a dataset and model from this daemon first.';
        return;
      }
      try {
        workflow.prepare(draft, data.value, model.value);
      } catch {
        message.value =
          'Selection or configuration is stale. Select again from the verified daemon.';
        return;
      }
      await work('preview', async (signal, isCurrent) => {
        const result = await workflow.preview(signal);
        if (!isCurrent()) return;
        plan.value = result;
        if (guided.value) step.value = 4;
      });
    },
    () => {
      if (current !== epoch) return;
      message.value = 'Review the validation errors before requesting a plan.';
    },
  )(event);
}
function submit() {
  return work('submit', async (signal, isCurrent) => {
    const approved = workflow.approved;
    const run = await workflow.submit(signal);
    if (!isCurrent()) return;
    acknowledged.value = run;
    if (guided.value) step.value = 5;
    message.value = 'Daemon acknowledged this exact plan.';
    emit('submitted', run);
    if (approved && isCurrent()) emit('submittedPlan', run, approved);
  });
}
function status() {
  return work('status', async (signal, isCurrent) => {
    const approved = workflow.approved;
    const run = await workflow.status(signal);
    if (!isCurrent()) return;
    reportedRun.value = run;
    message.value = 'reported';
    if (run.submission_requested) {
      acknowledged.value = run;
      if (guided.value) step.value = 5;
      emit('submitted', run);
      if (approved && isCurrent()) emit('submittedPlan', run, approved);
    }
  });
}
function openAcknowledged() {
  if (connected.value && acknowledged.value) emit('submitted', acknowledged.value);
}
function reset() {
  const config = structuredClone(trainingDefaults);
  config.data_path = data.value?.path ?? config.data_path;
  config.model = model.value?.model ?? config.model;
  resetForm({ values: { ...values, config } });
  resetConfirmation.value = false;
}
onBeforeUnmount(() => {
  unsubscribe?.();
  retireScope();
});
</script>
<template>
  <section class="mx-auto flex w-full max-w-5xl flex-col gap-8" aria-labelledby="project-title">
    <header>
      <h1 id="project-title" class="text-3xl font-medium">
        {{ translateKnownMessage('Build a training run') }}
      </h1>
      <p class="mt-3 text-muted-foreground">
        {{
          translateKnownMessage(
            'Author a draft, review a persisted daemon plan, then explicitly approve it. Nothing starts automatically.',
          )
        }}
      </p>
    </header>
    <Alert v-if="!connected"
      ><AlertTitle>{{ translateKnownMessage('Verified connection required') }}</AlertTitle
      ><AlertDescription>{{
        translateKnownMessage(
          'Connect to the daemon before choosing files, planning or submitting.',
        )
      }}</AlertDescription></Alert
    >
    <ProjectGuide
      :enabled="guided"
      :step="step"
      :busy="busy || advancing"
      @toggle="guided = !guided"
      @previous="step = Math.max(0, step - 1)"
      @next="nextStep"
    />
    <Alert v-if="message" role="alert"
      ><AlertTitle>{{ translateKnownMessage('Planning status') }}</AlertTitle
      ><AlertDescription>{{ displayMessage }}</AlertDescription></Alert
    >
    <div v-show="!guided || step === 0" class="flex flex-col gap-3">
      <details :open="guided">
        <summary class="cursor-pointer font-medium">
          {{ translateKnownMessage('Choose daemon dataset') }}
        </summary>
        <BrowseContainer
          :session="session"
          :label="translateKnownMessage('Training dataset')"
          @select="selectData"
        />
      </details>
      <p>
        {{
          t('Dataset: {path}{daemon}. Browser files are not uploaded.', {
            path: data?.path ?? translateKnownMessage('Not selected'),
            daemon: data ? t(' · daemon {id}', { id: data.daemonId }) : '',
          })
        }}
      </p>
      <DatasetInfoPanel :session="session" :selection="data" @inspected="inspectData" />
    </div>
    <div v-show="!guided || step === 1" class="flex flex-col gap-3">
      <details :open="guided">
        <summary class="cursor-pointer font-medium">
          {{ translateKnownMessage('Choose model') }}
        </summary>
        <ModelSelector
          :session="session"
          :inspection="datasetInspection"
          :single-channel="values.config.single_channel"
          @select="selectModel"
        />
      </details>
      <CustomModelSelector
        :session="session"
        :disabled="busy || !connected"
        @select="selectModel"
      />
      <p>
        {{
          t(
            'Model: {model}{custom}. Catalogue descriptions do not certify runtime compatibility.',
            {
              model: model?.model ?? translateKnownMessage('Not selected'),
              custom:
                model?.source === 'custom' ? translateKnownMessage(' · custom, unverified') : '',
            },
          )
        }}
      </p>
    </div>
    <div v-show="!guided || step === 2">
      <TrainingPresets :disabled="busy" @apply="applyPreset" />
    </div>
    <form
      v-show="!guided || step === 3 || step === 4"
      class="flex flex-col gap-8"
      @submit="preview"
    >
      <div v-show="!guided || step === 3" class="flex flex-col gap-8">
        <RuntimeFields :disabled="busy" /><EnvironmentFields
          :environment="values.runtime.environment"
          :disabled="busy"
          @update="setFieldValue('runtime.environment', $event)"
        /><StorageMappingFields
          :mappings="values.storage_map"
          :backend="values.backend"
          :disabled="busy"
          @update="setFieldValue('storage_map', $event)"
        /><TrainingFields :disabled="busy" />
      </div>
      <div class="flex flex-wrap gap-3">
        <Button type="submit" :disabled="!canPreview">{{
          translateKnownMessage(busy ? 'Waiting for daemon…' : 'Preview persisted plan')
        }}</Button
        ><Button
          type="button"
          variant="outline"
          :disabled="busy"
          @click="resetConfirmation = true"
          >{{ translateKnownMessage('Reset training defaults') }}</Button
        ><Button v-if="busy" type="button" variant="outline" @click="invalidate">{{
          translateKnownMessage('Stop waiting')
        }}</Button>
      </div>
      <div
        v-if="resetConfirmation"
        role="group"
        :aria-label="translateKnownMessage('Confirm reset')"
        class="flex flex-col gap-3"
      >
        <p>
          {{
            translateKnownMessage(
              'Reset training options? Your dataset, model and execution environment remain selected. This invalidates the preview, never changes an existing run.',
            )
          }}
        </p>
        <div class="flex gap-3">
          <Button type="button" @click="reset">{{ translateKnownMessage('Confirm reset') }}</Button
          ><Button type="button" variant="outline" @click="resetConfirmation = false">{{
            translateKnownMessage('Keep draft')
          }}</Button>
        </div>
      </div>
    </form>
    <PlanApproval
      v-if="plan && (!guided || step === 4)"
      :plan="plan"
      :acknowledged="acknowledged?.request_id === plan.request_id"
      :busy="busy || !connected"
      @submit="submit"
      @status="status"
    />
    <TrainingExport :draft="values" :disabled="busy" />
    <section
      v-if="acknowledged && (!guided || step === 5)"
      class="flex flex-col gap-3"
      :aria-label="translateKnownMessage('Acknowledged training run')"
    >
      <h2 class="text-xl font-medium">
        {{ translateKnownMessage('Daemon acknowledged the run') }}
      </h2>
      <p>
        {{
          t(
            '{run} · {state}. This acknowledgment is not proof of training completion; open the run monitor for current evidence.',
            { run: acknowledged.run_id, state: stateLabel(acknowledged.state) },
          )
        }}
      </p>
      <Button type="button" variant="outline" class="self-start" @click="openAcknowledged">{{
        translateKnownMessage('Open acknowledged run')
      }}</Button>
    </section>
  </section>
</template>
