<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useClientMessages } from '../../composables/useClientMessages';
import { runStateMessageKeys } from '../../i18n/dynamic-keys';
import DatasetInfoPanel from '../datasets/DatasetInfoPanel.vue';
import DatasetPathPicker from '../datasets/DatasetPathPicker.vue';
import { computed, onBeforeUnmount, shallowRef, watch, toRaw } from 'vue';
import { useForm } from 'vee-validate';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
import InfoChip from '../common/InfoChip.vue';

const { locale, t } = useI18n({ useScope: 'global' });
const { clientMessage } = useClientMessages();
function stateLabel(state: RunView['state']): string {
  return locale.value === 'en' ? state : t(runStateMessageKeys[state]);
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
    ? t('project.daemonReportsStateSubmission', {
        state: stateLabel(reportedRun.value.state),
        submission: t(
          reportedRun.value.submission_requested
            ? 'project.submissionRequested'
            : 'project.notSubmittedYet',
        ),
      })
    : message.value === 'project.submissionAckUnknown'
      ? t('project.submissionOutcomeUnknown')
      : message.value.startsWith('project.')
        ? t(message.value)
        : clientMessage(message.value),
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
    message.value = 'project.datasetRequired';
    return;
  }
  if (step.value === 1 && !model.value) {
    message.value = 'project.modelRequired';
    return;
  }
  if (step.value === 3) {
    advancing.value = true;
    try {
      const result = await validate();
      if (current !== epoch || step.value !== currentStep) return;
      if (!result.valid) {
        message.value = 'project.approvalValidationRequired';
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
          ? 'project.planRefused'
          : 'project.submissionAckUnknown';
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
        message.value = 'project.selectionRequired';
        return;
      }
      try {
        workflow.prepare(draft, data.value, model.value);
      } catch {
        message.value = 'project.selectionStale';
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
      message.value = 'project.planValidationRequired';
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
    message.value = 'project.daemonAcknowledgedThisExactPlan';
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
        {{ t('project.buildATrainingRun') }}
      </h1>
      <div class="flex flex-wrap items-center gap-3">
        <p class="mt-3 text-muted-foreground">{{ t('project.authoringHelp') }}</p>
        <span class="text-sm text-muted-foreground">{{ t('project.noAutomaticStart') }}</span>
      </div>
    </header>
    <Alert v-if="!connected"
      ><AlertTitle>{{ t('project.verifiedConnectionRequired') }}</AlertTitle
      ><AlertDescription>{{ t('project.connectionRequired') }}</AlertDescription></Alert
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
      ><AlertTitle>{{ t('project.planningStatus') }}</AlertTitle
      ><AlertDescription v-if="message !== 'project.submissionAckUnknown'">{{
        displayMessage
      }}</AlertDescription>
      <InfoChip
        v-else
        :label="t('project.submissionOutcomeUnknown')"
        :text="t('project.submissionAckUnknown')"
        uncertain
      />
    </Alert>
    <div v-show="!guided || step === 0" class="flex flex-col gap-3">
      <Collapsible :default-open="guided">
        <CollapsibleTrigger class="flex w-full items-center justify-between text-left font-medium">
          {{ t('project.chooseDaemonDataset') }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <DatasetPathPicker
            :session="session"
            :label="t('project.trainingDataset')"
            @select="selectData"
          />
        </CollapsibleContent>
      </Collapsible>
      <div class="flex flex-wrap gap-2">
        <Badge variant="outline" data-testid="selected-dataset">
          {{
            t('project.datasetSelectionSummary', {
              path: data?.path ?? t('project.notSelected'),
              daemon: data ? t('project.daemonId', { id: data.daemonId }) : '',
            })
          }}
        </Badge>
      </div>
      <DatasetInfoPanel :session="session" :selection="data" @inspected="inspectData" />
    </div>
    <div v-show="!guided || step === 1" class="flex flex-col gap-3">
      <Collapsible :default-open="guided">
        <CollapsibleTrigger class="flex w-full items-center justify-between text-left font-medium">
          {{ t('project.chooseModel') }}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ModelSelector
            :session="session"
            :inspection="datasetInspection"
            :single-channel="values.config.single_channel"
            @select="selectModel"
          />
        </CollapsibleContent>
      </Collapsible>
      <CustomModelSelector
        :session="session"
        :disabled="busy || !connected"
        @select="selectModel"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="outline" data-testid="selected-model">
          {{
            t('project.modelSelectionSummary', {
              model: model?.model ?? t('project.notSelected'),
              custom: model?.source === 'custom' ? t('project.customUnverified') : '',
            })
          }}
        </Badge>
        <InfoChip
          :label="t('project.modelCompatibilityChip')"
          :text="t('project.modelCompatibilityDetails')"
          uncertain
        />
      </div>
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
          t(busy ? 'project.waitingForDaemon' : 'project.previewPersistedPlan')
        }}</Button
        ><Button
          type="button"
          variant="outline"
          :disabled="busy"
          @click="resetConfirmation = true"
          >{{ t('project.resetTrainingDefaults') }}</Button
        ><Button v-if="busy" type="button" variant="outline" @click="invalidate">{{
          t('project.stopWaiting')
        }}</Button>
      </div>
      <div
        v-if="resetConfirmation"
        role="group"
        :aria-label="t('project.confirmReset')"
        class="flex flex-col gap-3"
      >
        <p class="text-sm text-muted-foreground">{{ t('project.resetHelp') }}</p>
        <div class="flex gap-3">
          <Button type="button" @click="reset">{{ t('project.confirmReset') }}</Button
          ><Button type="button" variant="outline" @click="resetConfirmation = false">{{
            t('project.keepDraft')
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
      :aria-label="t('project.acknowledgedTrainingRun')"
    >
      <h2 class="text-xl font-medium">
        {{ t('project.daemonAcknowledgedTheRun') }}
      </h2>
      <InfoChip
        :label="t('project.submissionEvidence')"
        :text="
          t('project.submissionAckHelp', {
            run: acknowledged.run_id,
            state: stateLabel(acknowledged.state),
          })
        "
        uncertain
      />
      <Button type="button" variant="outline" class="self-start" @click="openAcknowledged">{{
        t('project.openAcknowledgedRun')
      }}</Button>
    </section>
  </section>
</template>
